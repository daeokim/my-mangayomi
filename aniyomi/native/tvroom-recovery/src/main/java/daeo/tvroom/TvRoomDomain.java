package daeo.tvroom;

import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.CancellationException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;
import org.json.JSONObject;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Element;

/** Pure Java policy; the injected Host retains the APK's original Cronet engine. */
public final class TvRoomDomain {
    public interface Callback { void success(byte[] body); void error(Throwable error); }
    public interface Host {
        String read();
        boolean write(String base);
        void changed(String base);
        boolean active();
        Object suspended();
        void complete(String body, Throwable error);
        void raw(String url, Map<String,String> headers, int timeoutMillis, Callback callback);
    }
    public static final String SEED = "https://tvroom40.org";
    public static final String REGISTRY = "https://daeokim.github.io/my-mangayomi/domains.json";
    public static final int MAX_BYTES = 1024 * 1024;
    private static final Pattern HOST = Pattern.compile("(?:www\\.)?tvroom([1-9][0-9]{0,5})\\.org");
    private static final Pattern BLOCKED = Pattern.compile("cf-chl-|challenge-platform|just a moment|verify (?:that )?you are human|checking your browser|captcha|access denied|domain (?:is )?for sale|parkingcrew|sedoparking", Pattern.CASE_INSENSITIVE);
    private static final TvRoomDomain SHARED = new TvRoomDomain();
    private String base = SEED, hint = "", failedBase = "";
    private boolean loaded;
    private long hintAt, failedAt;

    public static String currentNative(Host host) { return SHARED.current(host); }
    public static Object fetchNative(Host host, String url, Map<String,String> headers) throws Throwable {
        return SHARED.fetch(host,url,headers);
    }
    public static boolean isSiteRequest(String url) { return !origin(url).isEmpty(); }
    public static String normalize(String value) {
        if (value == null) return "";
        try {
            URI u = new URI(value);
            if (!"https".equals(u.getScheme()) || u.getRawUserInfo()!=null || u.getPort()!=-1 ||
                u.getRawQuery()!=null || u.getRawFragment()!=null || !(u.getRawPath().isEmpty() || "/".equals(u.getRawPath())) ||
                u.getHost()==null || !HOST.matcher(u.getHost()).matches()) return "";
            return "https://"+u.getHost();
        } catch (Exception e) { return ""; }
    }
    public static String origin(String value) {
        try {
            URI u = new URI(value);
            if (u.getRawUserInfo()!=null || u.getPort()!=-1) return "";
            return normalize(u.getScheme()+"://"+u.getHost());
        } catch (Exception e) { return ""; }
    }
    public static int number(String value) {
        java.util.regex.Matcher m=HOST.matcher(URI.create(value).getHost());
        if (!m.matches()) throw new IllegalArgumentException("tvroom_origin");
        return Integer.parseInt(m.group(1));
    }
    public static List<String> candidates(String base, String hint) {
        int n=number(base); LinkedHashSet<String> out=new LinkedHashSet<>();
        String preferred=normalize(hint);
        if (!preferred.isEmpty() && number(preferred)>n) out.add(preferred);
        for (int i=1;i<=5 && n+i<=999999;i++) out.add("https://tvroom"+(n+i)+".org");
        return new ArrayList<>(out);
    }
    public static boolean blocked(String html) { return BLOCKED.matcher(html).find(); }
    public static boolean validCatalog(String html, String base) {
        if (html==null || html.getBytes(StandardCharsets.UTF_8).length>MAX_BYTES || blocked(html)) return false;
        org.jsoup.nodes.Document doc=Jsoup.parse(html,base);
        if (!Pattern.compile("tvroom|티비룸",Pattern.CASE_INSENSITIVE).matcher(doc.title()).find()) return false;
        // These are the exact selectors consumed by the existing qb.O() parser.
        for (Element card:doc.select(".module-item .v-item")) {
            Element a=card.selectFirst("a.v-item-hitarea[href][aria-label]");
            if (a==null || a.attr("aria-label").trim().isEmpty()) continue;
            String link=a.absUrl("href");
            if (!origin(link).equals(base)) continue;
            String path=URI.create(link).getPath();
            if (!path.matches("/video/[^/]+/?")) continue;
            String slug=path.substring(7).replaceAll("/$","");
            if (Arrays.asList("영화","드라마","TV예능","음악프로","애니","시사다큐").contains(slug)) continue;
            for (Element img:card.select(".v-item-cover img")) {
                for (String key:Arrays.asList("data-src","data-original","src")) {
                    String image=img.attr(key);
                    if (image.matches("(?:https://[^\\s]+|/[^\\s]+)")) return true;
                }
            }
        }
        return false;
    }
    /** Do not follow a candidate to a different origin or a non-HTTPS target. */
    public static boolean allowRedirect(String from, String to) {
        try {
            String target=URI.create(from).resolve(to).toString();
            String expected=origin(from);
            if (from.equals(REGISTRY)) expected="https://daeokim.github.io";
            URI u=URI.create(target);
            return !expected.isEmpty() && u.getRawUserInfo()==null && u.getPort()==-1 &&
                ("https://"+u.getHost()).equals(expected) && "https".equals(u.getScheme());
        } catch (Exception e) { return false; }
    }
    public synchronized String current(Host host) {
        if (!loaded) {
            String saved=normalize(host.read());
            if (!saved.isEmpty() && number(saved)>=number(base)) base=saved;
            loaded=true;
        }
        host.changed(base); return base;
    }
    public synchronized String remember(Host host,String candidate) {
        current(host); String clean=normalize(candidate);
        if (clean.isEmpty() || number(clean)<number(base)) return base;
        if (!clean.equals(base)) {
            if (!host.write(clean)) return base; // Failed persistence never looks like success.
            base=clean;
        }
        host.changed(base); return base;
    }
    public Object fetch(Host host,String url,Map<String,String> headers) throws Throwable {
        Flow f=new Flow(host,url,headers);
        synchronized(f) {
            f.start(); f.starting=false;
            if (f.done) { if(f.error!=null) throw f.error; return f.body; }
            return host.suspended();
        }
    }
    private final class Flow {
        final Host host; final String original; final Map<String,String> headers;
        boolean starting=true,done,retried; String body,requestBase; Throwable error,originalError;
        List<String> choices; int next;
        Flow(Host host,String url,Map<String,String> headers) {this.host=host;original=url;this.headers=headers;}
        void finish(String value,Throwable failure) {
            synchronized(this) {
                if(done)return;
                done=true;body=value;error=failure;
                if(starting)return;
            }
            host.complete(value,failure);
        }
        void call(String url,Map<String,String> h,int timeout,Callback cb) {
            if (!host.active()) { finish(null,new CancellationException("TVRoom request cancelled"));return; }
            final AtomicBoolean delivered=new AtomicBoolean();
            final Callback target=cb;
            Callback once=new Callback() {
                public void success(byte[] body) {if(delivered.compareAndSet(false,true))target.success(body);}
                public void error(Throwable e) {if(delivered.compareAndSet(false,true))target.error(e);}
            };
            try { host.raw(url,h,timeout,once); } catch(Throwable e) {once.error(e);}
        }
        boolean cancelled(Throwable e) {
            if (!host.active()) {finish(null,new CancellationException("TVRoom request cancelled"));return true;}
            return false;
        }
        void start() {
            current(host);
            boolean refresh;
            synchronized(TvRoomDomain.this) {
                long now=System.nanoTime(); refresh=hintAt==0 || now-hintAt>=600000000000L;
                if(refresh)hintAt=now;
            }
            if(!refresh) {preferred();return;}
            call(REGISTRY,Collections.<String,String>emptyMap(),4000,new Callback() {
                public void success(byte[] raw) {
                    String value="";
                    try {
                        JSONObject d=new JSONObject(new String(raw,StandardCharsets.UTF_8)).getJSONObject("domains").getJSONObject("tvroom");
                        if (Arrays.asList("healthy","protected").contains(d.optString("status"))) value=normalize(d.getString("baseUrl"));
                    } catch(Exception ignored) { }
                    synchronized(TvRoomDomain.this) {hint=value;}
                    preferred();
                }
                public void error(Throwable e) {if(!cancelled(e))preferred();}
            });
        }
        void preferred() {
            String saved=current(host), preferred;
            synchronized(TvRoomDomain.this){preferred=hint;}
            if (!preferred.isEmpty() && number(preferred)>number(saved)) {
                probe(preferred,new Runnable(){public void run(){request();}});
            } else request();
        }
        void probe(final String candidate,final Runnable after) {
            call(candidate+"/",siteHeaders(candidate),4000,new Callback() {
                public void success(byte[] raw) {
                    try {
                        if(validCatalog(new String(raw,StandardCharsets.UTF_8),candidate))remember(host,candidate);
                    } catch(RuntimeException ignored) { }
                    after.run();
                }
                public void error(Throwable e) {if(!cancelled(e))after.run();}
            });
        }
        void request() {
            requestBase=current(host);
            String old=origin(original);
            String url=requestBase+original.substring(old.length());
            call(url,rewriteHeaders(headers,old,requestBase),15000,new Callback() {
                public void success(byte[] raw) {
                    String text=new String(raw,StandardCharsets.UTF_8);
                    if(blocked(text))failed(new IOException("TVRoom protection page"));
                    else finish(text,null);
                }
                public void error(Throwable e) {if(!cancelled(e))failed(e);}
            });
        }
        void failed(Throwable e) {
            if(retried || !recoverable(e)) {finish(null,e);return;}
            originalError=e;
            synchronized(TvRoomDomain.this) {
                if(number(base)>number(requestBase)) {retried=true;request();return;}
                long now=System.nanoTime();
                if(failedBase.equals(requestBase) && now-failedAt<60000000000L){finish(null,e);return;}
                // Set before probing, so four category requests cannot launch four scans.
                failedBase=requestBase; failedAt=now;
                choices=candidates(requestBase,""); // Higher hint was already verified first.
            }
            nextCandidate();
        }
        void nextCandidate() {
            if(number(current(host))>number(requestBase)) {retried=true;request();return;}
            if(next>=choices.size()) {finish(null,originalError);return;}
            String candidate=choices.get(next++);
            probe(candidate,new Runnable(){public void run(){nextCandidate();}});
        }
    }
    public static boolean recoverable(Throwable e) {
        if(e instanceof CancellationException && !e.getClass().getSimpleName().contains("Timeout"))return false;
        String m=String.valueOf(e.getMessage());
        if(m.startsWith("HTTP ")) return m.startsWith("HTTP 403:") || m.equals("HTTP 403") || m.startsWith("HTTP 530:");
        if(e instanceof IOException || e.getClass().getSimpleName().contains("Timeout"))return true;
        return m.startsWith("연결 실패:") || m.startsWith("TVRoom protection page");
    }
    private static Map<String,String> siteHeaders(String base) {
        Map<String,String> out=new LinkedHashMap<>();out.put("Referer",base+"/");out.put("Origin",base);return out;
    }
    static Map<String,String> rewriteHeaders(Map<String,String> input,String from,String to) {
        if(from.equals(to))return new LinkedHashMap<>(input);
        Map<String,String> out=new LinkedHashMap<>();
        for(Map.Entry<String,String> h:input.entrySet()) {
            String key=h.getKey();
            if(Arrays.asList("authorization","cookie","origin","referer","host").contains(key.toLowerCase(Locale.ROOT)))continue;
            out.put(key,h.getValue());
        }
        out.putAll(siteHeaders(to));return out;
    }
}
