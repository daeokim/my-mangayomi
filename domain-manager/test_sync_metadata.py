import io
import json
from pathlib import Path
import tempfile
import shutil
import unittest
from unittest.mock import patch
import sync_metadata as sync

class MetadataTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.state = {'schemaVersion': 1, 'domains': {}, 'control': {'overrides': {}}}
        catalogs = {'index.json': [], 'anime_index.json': []}
        bases = {'11toon': 'https://11toon.com', 'blacktoon': 'https://blacktoon424.com',
                 'goodtoon': 'https://goodtoon007.com', 'tvwiki': 'https://tvwiki53.net', 'tvroom': 'https://tvroom38.org'}
        rows = []
        for index, (key, (source, catalog, _)) in enumerate(sync.PROFILES.items()):
            self.state['domains'][key] = {'baseUrl': bases[key], 'status': 'healthy', 'lastConfirmedAt': '2026-10-14T08:20:00Z'}
            p = self.root / source
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text('const metadata = {baseUrl: "' + bases[key] + '", version: "0.1.12"};\n'
                         'const fallback = "' + bases[key] + '";\n'
                         'const key="tvwiki_last_base_url_v3"; const time="tvwiki_last_base_time_v3";\n'
                         'function check(match){return Number(match[1]) >= 53;}\n')
            catalogs[catalog].append({'name': key, 'id': 1676055829884576659 + index, 'baseUrl': bases[key],
                'version': '0.1.12', 'appMinVerReq': '0.9.2', 'sourceCodeUrl': 'https://daeokim.github.io/my-mangayomi/' + source})
            rows.append(f'| {key} | 0.1.12 | {bases[key]} | 0.9.2 |')
        for path, entries in catalogs.items():
            (self.root / path).write_text(json.dumps(entries, indent=2))
        (self.root / 'README.md').write_text('\n'.join(rows) + '\n')
        self.save_state()

    def save_state(self):
        (self.root / 'domains.json').write_text(json.dumps(self.state))

    def test_generated_categories_and_new_anime_follow_atomic_domain_updates(self):
        repo = Path(__file__).resolve().parents[1]
        # Real catalogs and templates exercise standalone generation and preserve IDs.
        for name in ('anime_index.json', 'index.json', 'README.md', 'domains.json'):
            shutil.copyfile(repo / name, self.root / name)
        shutil.copytree(repo / 'javascript', self.root / 'javascript', dirs_exist_ok=True)
        state = json.loads((self.root / 'domains.json').read_text())
        catalog = json.loads((self.root / 'anime_index.json').read_text())
        ids = [e['id'] for e in catalog]
        for key, host in [('tvroom', 'https://tvroom999.org'), ('ani24', 'https://ohli999.net'), ('anilife', 'https://anilife999.tv')]:
            state['domains'][key].update(baseUrl=host, lastConfirmedAt='2026-10-18T16:00:00Z')
        (self.root / 'domains.json').write_text(json.dumps(state))
        changes = sync.build_changes(self.root)
        updated = json.loads(changes['anime_index.json'])
        self.assertEqual([e['id'] for e in updated], ids)
        for entry in updated:
            if entry['name'].startswith('티비룸'):
                self.assertEqual(entry['baseUrl'], 'https://tvroom999.org')
                self.assertEqual(entry['version'], sync.bump(catalog[0]['version']))
                path = entry['sourceCodeUrl'].split('/my-mangayomi/')[1]
                self.assertIn('https://tvroom999.org', changes[path])
                self.assertIn(entry['version'], changes[path])
        self.assertIn('https://ohli999.net', changes['javascript/anime/ani24.js'])
        self.assertIn('https://anilife999.tv', changes['javascript/anime/anilife.js'])
        # JS address/version updates must preserve every APK release table row.
        apk_names = {'Manga', 'Naver', 'TVRoom', 'TVWiki', 'Ani24', 'AniLife'}
        apk_rows = [row for row in (repo/'README.md').read_text().splitlines()
                    if row.startswith('| ') and row.split('|')[1].strip() in apk_names]
        self.assertEqual(len(apk_rows), 6)
        for row in apk_rows:
            self.assertIn(row, changes['README.md'])
        for path, text in changes.items():
            (self.root / path).write_text(text)
        self.assertEqual(sync.build_changes(self.root), {})

    def test_native_catalog_updates_only_confirmed_nonregressing_addresses(self):
        p = self.root / 'aniyomi/media/index.min.json'
        p.parent.mkdir(parents=True)
        entry = {'pkg': 'eu.kanade.tachiyomi.animeextension.ko.daeoanilife',
                 'version': '14.1001', 'sources': [{'id': '850164079243120202', 'baseUrl': 'https://anilife01.tv'}]}
        p.write_text(json.dumps([entry]))
        self.state['domains']['anilife'] = {'baseUrl': 'https://anilife02.tv', 'lastConfirmedAt': None}
        self.save_state()
        self.assertEqual(sync.build_changes(self.root), {})
        self.state['domains']['anilife']['lastConfirmedAt'] = '2026-10-16T04:00:00Z'
        self.save_state()
        changes = sync.build_changes(self.root)
        updated, = json.loads(changes['aniyomi/media/index.min.json'])
        self.assertEqual(updated['version'], '14.1001')
        self.assertEqual(updated['sources'][0]['baseUrl'], 'https://anilife02.tv')
        p.write_text(changes['aniyomi/media/index.min.json'])
        self.state['domains']['anilife']['baseUrl'] = 'https://anilife01.tv'
        self.save_state()
        self.assertEqual(sync.build_changes(self.root), {})
        self.state['domains']['anilife']['baseUrl'] = 'https://anilife03.tv'
        self.state['control']['overrides']['anilife'] = 'https://anilife03.tv'
        self.save_state()
        self.assertEqual(sync.build_changes(self.root), {})

    def test_update_is_atomic_plan_with_version_cache_floor_and_exact_ids(self):
        self.state['domains']['tvwiki']['baseUrl'] = 'https://tvwiki54.net'
        self.save_state()
        changes = sync.build_changes(self.root)
        self.assertEqual(set(changes), {'javascript/anime/tvwiki.js', 'anime_index.json', 'README.md'})
        code = changes['javascript/anime/tvwiki.js']
        self.assertIn('version: "0.1.13"', code)
        self.assertIn('tvwiki_last_base_url_domain54', code)
        self.assertIn('Number(match[1]) >= 54', code)
        entries = json.loads(changes['anime_index.json'])
        self.assertEqual(entries[0]['id'], 1676055829884576662)
        self.assertIn('| tvwiki | 0.1.13 | https://tvwiki54.net |', changes['README.md'])
        for path, text in changes.items():
            (self.root / path).write_text(text)
        self.assertEqual(sync.build_changes(self.root), {})

    def test_preserves_last_confirmed_address_when_next_scan_is_protected(self):
        self.state['domains']['tvroom'].update(baseUrl='https://tvroom40.org', status='protected')
        self.save_state()
        self.assertIn('https://tvroom40.org', sync.build_changes(self.root)['javascript/anime/tvroom.js'])

    def test_unconfirmed_seeds_and_operator_pins_do_not_rewrite_defaults(self):
        self.state['domains']['tvwiki'].update(baseUrl='https://tvwiki54.net', lastConfirmedAt=None)
        self.state['domains']['tvroom']['baseUrl'] = 'https://tvroom40.org'
        self.state['control']['overrides']['tvroom'] = 'https://tvroom40.org'
        self.save_state()
        self.assertEqual(sync.build_changes(self.root), {})

    def test_older_domain_does_not_regress_code_and_catalog(self):
        self.state['domains']['tvwiki']['baseUrl'] = 'https://tvwiki52.net'
        self.save_state()
        self.assertEqual(sync.build_changes(self.root), {})

    def test_foreign_hosts_credentials_and_paths_are_rejected(self):
        for value in ['http://tvwiki54.net', 'https://evil.invalid', 'https://secret@tvwiki54.net', 'https://tvwiki54.net/other']:
            self.state['domains']['tvwiki']['baseUrl'] = value
            self.save_state()
            with self.assertRaises(ValueError):
                sync.build_changes(self.root)

    def test_www_only_change_does_not_create_an_extension_update(self):
        self.state['domains']['tvwiki']['baseUrl'] = 'https://www.tvwiki53.net/'
        self.save_state()
        self.assertEqual(sync.build_changes(self.root), {})

    def test_publisher_does_not_force_or_overwrite_a_concurrent_main_commit(self):
        with patch.dict('os.environ', {'GITHUB_TOKEN': 'test-only', 'GITHUB_REPOSITORY': 'daeokim/my-mangayomi'}), \
             patch('sync_metadata.subprocess.check_output', return_value='original\n'), \
             patch('sync_metadata.urllib.request.urlopen', return_value=io.BytesIO(json.dumps({'object': {'sha': 'concurrent'}}).encode())) as fetch:
            with self.assertRaisesRegex(RuntimeError, 'branch_changed'):
                sync.publish_changes(self.root, {'README.md': 'content'})
            self.assertEqual(fetch.call_count, 1)

    def test_publisher_creates_one_commit_containing_all_files_then_fast_forwards(self):
        calls = []
        replies = [{'object': {'sha': 'original'}}, {'tree': {'sha': 'base-tree'}}, {'sha': 'new-tree'}, {'sha': 'new-commit'}, {'object': {'sha': 'new-commit'}}]
        def fetch(request, **kwargs):
            calls.append((request.full_url, request.get_method(), json.loads(request.data) if request.data else None))
            return io.BytesIO(json.dumps(replies[len(calls) - 1]).encode())
        with patch.dict('os.environ', {'GITHUB_TOKEN': 'test-only', 'GITHUB_REPOSITORY': 'daeokim/my-mangayomi'}), \
             patch('sync_metadata.subprocess.check_output', return_value='original\n'), \
             patch('sync_metadata.urllib.request.urlopen', side_effect=fetch):
            self.assertEqual(sync.publish_changes(self.root, {'README.md': 'a', 'anime_index.json': 'b'}), 'new-commit')
        self.assertEqual(len(calls[2][2]['tree']), 2)
        self.assertEqual(calls[3][2]['parents'], ['original'])
        self.assertEqual(calls[4][1], 'PATCH')
        self.assertIs(calls[4][2]['force'], False)

if __name__ == '__main__':
    unittest.main()
