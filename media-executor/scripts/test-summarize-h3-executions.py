import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('ledger', Path(__file__).with_name('summarize-h3-executions.py'))
ledger = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ledger)


class ExecutionLedgerTest(unittest.TestCase):
    def test_raw_comfy_response_and_saved_copies_count_once(self):
        history = {'prompt': [0, 'task-1', {'1': {'class_type': 'MiniMaxH3ReferenceToVideo'}, '2': {'class_type': 'SamplerCustomAdvanced'}}],
                   'status': {'status_str': 'success', 'messages': [['execution_start', {'timestamp': 1000}], ['execution_success', {'timestamp': 3000}]]}}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'raw-history.json').write_text(json.dumps({'task-1': history}))
            result = ledger.summarize([root])
            self.assertEqual((result['uniqueTasks'], result['recordedExecutionSeconds']), (1, 2))
            (root / 'history.json').write_text(json.dumps(history))
            (root / 'report.json').write_text(json.dumps({'history': history}))
            result = ledger.summarize([root])
            self.assertEqual((result['uniqueTasks'], result['duplicateCopiesExcluded'], result['recordedExecutionSeconds']), (1, 2, 2))
            history['status']['messages'][-1][1]['timestamp'] = 4000
            (root / 'report.json').write_text(json.dumps({'history': history}))
            with self.assertRaisesRegex(ValueError, 'Conflicting histories'):
                ledger.summarize([root])


if __name__ == '__main__':
    unittest.main()
