import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from datetime import date
import runway_video as client


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        client.save(self.root / 'config.json', {
            'budget_usd': 1, 'budget_authorization': {'note': 'test-only'},
            'pricing_checked': date.today().isoformat(), 'usd_per_credit': 0.01,
            'credits_per_second': {'gen4.5': 12, 'gen4_turbo': 5}})
        (self.root / 'frame.png').write_bytes(b'\x89PNG\r\n\x1a\n' + bytes(32))
        self.manifest = self.root / 'scene.json'
        client.save(self.manifest, {'id': 'scene', 'image': 'frame.png', 'model': 'gen4.5',
            'duration': 5, 'ratio': '720:1280', 'prompt': 'Camera moves slowly.',
            'timeline': {'from_frame': 30, 'fps': 30}})

    def tearDown(self):
        self.temp.cleanup()

    def test_no_network_in_plan(self):
        with patch.object(client, 'api', side_effect=AssertionError('network')):
            summary = client.plan(self.root, self.manifest)[3]
        self.assertEqual(summary['estimated_usd'], 0.6)
        self.assertFalse(summary['network_used'])

    def test_budget_and_upload_gate_before_network(self):
        with patch.object(client, 'api') as network:
            with self.assertRaises(ValueError):
                client.submit(self.root, self.manifest, False)
            config = client.read(self.root / 'config.json')
            config['budget_usd'] = 0
            client.save(self.root / 'config.json', config)
            with self.assertRaises(ValueError):
                client.submit(self.root, self.manifest, True)
            network.assert_not_called()

    def test_timeout_never_resubmits_and_reserves_cost(self):
        with patch.object(client, 'credential', return_value='test'), patch.object(client, 'api', side_effect=ValueError('timeout')) as network:
            with self.assertRaises(ValueError):
                client.submit(self.root, self.manifest, True)
            result = client.submit(self.root, self.manifest, True)
            self.assertEqual(result['status'], 'UNKNOWN')
            self.assertEqual(network.call_count, 1)
            self.assertEqual(client.total_reserved(self.root), 0.6)

    def test_generate_resume_import_and_duplicate_id(self):
        mp4 = b'\x00\x00\x00\x18ftypmp42' + bytes(64)
        def fake_download(url, dest):
            dest.write_bytes(mp4)
        with patch.object(client, 'credential', return_value='test'), patch.object(client, 'api', return_value={'id': 'remote-123'}) as network:
            client.submit(self.root, self.manifest, True)
            client.submit(self.root, self.manifest, True)
            self.assertEqual(network.call_count, 1)
            body = network.call_args.args[3]
            self.assertTrue(body['promptImage'].startswith('data:image/png;base64,'))
        with patch.object(client, 'credential', return_value='test'), patch.object(client, 'api', return_value={'status': 'SUCCEEDED', 'output': ['https://example.com/clip.mp4']}), patch.object(client, 'download', side_effect=fake_download):
            result = client.sync(self.root, 'scene')
        self.assertTrue(Path(result['file']).exists())
        project = self.root / 'remotion'
        (project / 'src').mkdir(parents=True)
        (project / 'src/AiVideoLayer.tsx').write_text('test fixture')
        client.import_clip(self.root, 'scene', project)
        client.import_clip(self.root, 'scene', project)
        clips = client.read(project / 'src/ai-video-manifest.json')
        self.assertEqual(len(clips), 1)
        self.assertEqual(clips[0]['from'], 30)
        self.assertEqual(clips[0]['durationInFrames'], 150)
        self.assertEqual((project / 'public/ai-video/scene.mp4').read_bytes(), mp4)
        job = client.read(self.root / 'jobs/scene/job.json')
        self.assertEqual(job['output_sha256'], hashlib.sha256(mp4).hexdigest())
        self.assertNotIn('example.com', json.dumps(job))

    def test_budget_is_cumulative_and_id_changes_are_rejected(self):
        with patch.object(client, 'credential', return_value='test'), patch.object(client, 'api', return_value={'id': 'remote'}):
            client.submit(self.root, self.manifest, True)
        spec = client.read(self.manifest)
        spec['prompt'] = 'Changed scene'
        client.save(self.manifest, spec)
        with self.assertRaises(ValueError):
            client.submit(self.root, self.manifest, True)
        spec['id'] = 'second-scene'
        client.save(self.manifest, spec)
        with self.assertRaises(ValueError):
            client.submit(self.root, self.manifest, True)

    def test_active_lock_blocks_submission(self):
        with client.locked(self.root):
            with self.assertRaises(ValueError):
                client.submit(self.root, self.manifest, True)


if __name__ == '__main__':
    unittest.main()
