"""Decode an encrypted synthetic VOD through the extension's local HLS route.

The HTTP fixture models the official 0.9.9 HlsProxyService URL contract; this
does not replace an Android/libmpv device test. No third-party media is fetched.
"""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import base64
import json
import shutil
import subprocess
import tempfile
import threading
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def run():
    with tempfile.TemporaryDirectory(prefix="daeo-local-hls-") as folder:
        work = Path(folder)
        key = b"0123456789abcdef"
        (work / "key.bin").write_bytes(key)
        (work / "key.info").write_text("../keys/envelope\n" + str(work / "key.bin") + "\n00000000000000000000000000000001\n")
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=64x64:rate=5", "-t", "4", "-c:v", "libx264", "-preset", "ultrafast", "-g", "5", "-hls_time", "1", "-hls_key_info_file", str(work / "key.info"), str(work / "main.m3u8")], check=True)
        headers = {"User-Agent": "Daeo-HLS-Fixture", "Referer": "https://player.example/watch/1", "Origin": "https://player.example"}
        upstream_hits, proxy_hits = [], []

        class CdnHandler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_GET(self):
                upstream_hits.append(self.path)
                if any(self.headers.get(name) != value for name, value in headers.items()):
                    self.send_error(403)
                    return
                name = Path(urllib.parse.urlsplit(self.path).path).name
                target = work / name
                if not target.is_file() or not name.endswith(".ts"):
                    self.send_error(404)
                    return
                content = target.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "video/mp2t")
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)

        cdn = ThreadingHTTPServer(("127.0.0.1", 0), CdnHandler)
        cdn_origin = "http://127.0.0.1:" + str(cdn.server_port)

        class ProxyHandler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_GET(self):
                proxy_hits.append(self.path)
                encoded = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)["url"][0]
                target = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)).decode()
                if not target.startswith(cdn_origin + "/"):
                    self.send_error(400)
                    return
                with urllib.request.urlopen(urllib.request.Request(target, headers=headers), timeout=5) as response:
                    content = response.read()
                self.send_response(200)
                self.send_header("Content-Type", "video/mp2t")
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)

        proxy = ThreadingHTTPServer(("127.0.0.1", 0), ProxyHandler)
        for server in (cdn, proxy):
            threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            payload = {"source": str(ROOT / "javascript/anime/tvroom.js"), "playlistUrl": cdn_origin + "/vod/main.m3u8", "playlist": (work / "main.m3u8").read_text(), "headers": headers, "keyUrl": cdn_origin + "/keys/envelope", "keyData": "data:application/octet-stream;base64," + base64.b64encode(key).decode(), "localUrl": "http://127.0.0.1:" + str(proxy.server_port) + "/test-session/playlist.m3u8?url=dGVzdA"}
            js = """const fs=require('fs'),vm=require('vm');const input=JSON.parse(fs.readFileSync(0,'utf8'));const s={MProvider:class{},SharedPreferences:class{},createHlsProxyUrl:async()=>input.localUrl};vm.createContext(s);vm.runInContext(fs.readFileSync(input.source,'utf8')+';globalThis.extension=new DefaultExtension()',s);s.dcLocalHlsVideo(input.playlistUrl,input.playlist,input.headers,s.extension._absoluteUrl.bind(s.extension),input.keyUrl,input.keyData,input.playlistUrl,true).then(v=>process.stdout.write(JSON.stringify(v)));"""
            video = json.loads(subprocess.check_output(["node", "-e", js], input=json.dumps(payload).encode()))
            assert video["url"].startswith("lavf://data:"), "Missing mpv FFmpeg protocol adapter"
            # Standalone FFmpeg receives the data URI after mpv strips lavf://.
            raw_data_url = video["url"][len("lavf://"):]
            result = subprocess.run(["ffmpeg", "-v", "error", "-i", raw_data_url, "-map", "0:v:0", "-f", "framemd5", "-"], capture_output=True, text=True, timeout=30)
            if result.returncode:
                raise RuntimeError(result.stderr[:2000])
            frames = [line for line in result.stdout.splitlines() if line and not line.startswith("#")]
            assert len(frames) == 20, len(frames)
            assert len(proxy_hits) == 4, proxy_hits
            assert len(upstream_hits) == 4, upstream_hits
            assert all(".ts" in hit for hit in upstream_hits)
            report = {"decoded_frames": len(frames), "local_proxy_segment_requests": len(proxy_hits), "cdn_segment_requests": len(upstream_hits), "external_key_requests": 0, "original_headers_required": True, "synthetic_fixture_only": True, "mpv_verified": False}
            if shutil.which("mpv"):
                proxy_hits.clear()
                upstream_hits.clear()
                args = ["mpv", "--no-config", "--no-audio", "--vo=null", "--hwdec=no", "--cache=no", "--untimed", "--frames=20", "--term-playing-msg=DAEO_MPV_LOADED"]
                before = subprocess.run(args + [raw_data_url], capture_output=True, text=True, timeout=15)
                assert before.returncode != 0, "Bare data URI unexpectedly worked; re-check the mpv compatibility diagnosis"
                assert not proxy_hits, "Rejected root URI must not reach the segment proxy"
                after = subprocess.run(args + [video["url"]], capture_output=True, text=True, timeout=20)
                output = after.stdout + after.stderr
                assert after.returncode == 0, output[:1500]
                assert "DAEO_MPV_LOADED" in output and "VO: [null]" in output, output[:1500]
                assert proxy_hits and upstream_hits, "mpv must request the protected fixture segments"
                report.update({"mpv_verified": True, "mpv_bare_data_rejected": True, "mpv_local_proxy_segment_requests": len(proxy_hits)})
            print(json.dumps(report, ensure_ascii=False))
        finally:
            for server in (proxy, cdn):
                server.shutdown()
                server.server_close()


if __name__ == "__main__":
    run()
