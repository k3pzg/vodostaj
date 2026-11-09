import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import scraper as s
from rating_curve import build_estimates, estimate, fit_curve
from test_scraper import NOW, html, key


def calibration():
    rows = {}
    for day, h, q in [(17, 10, .05), (18, 15, .12), (19, 20, .36), (20, 25, .62), (21, 30, .91)]:
        for hour in range(5):
            rows.update(s.merge_rows({}, {key(hour, day): str(h)}, {key(hour, day): str(q)}))
    return rows


class CurveTests(unittest.TestCase):
    def test_nonlinear_interpolation_and_no_extrapolation(self):
        curve = build_estimates(calibration())['model']
        self.assertAlmostEqual(estimate(curve, 20), .36)
        self.assertAlmostEqual(estimate(curve, 22.5), .49)
        self.assertNotAlmostEqual(estimate(curve, 10) / 10, estimate(curve, 30) / 30)
        self.assertIsNone(estimate(curve, 9))
        self.assertIsNone(estimate(curve, 31))
        self.assertIsNone(estimate(curve, float('nan')))

    def test_isotonic_fit_robust_to_conflicting_pairs_and_large_gaps(self):
        pairs = [(h, q) for h, q in [(0, 0), (10, 2), (20, 1), (30, 4), (100, 10)] for _ in range(5)]
        curve = fit_curve(pairs)
        self.assertLessEqual(estimate(curve, 10), estimate(curve, 20))
        self.assertIsNone(estimate(curve, 50))
        # Median limits the effect of an isolated bad historical value.
        curve = fit_curve([(h, h*h) for h in range(5) for _ in range(5)] + [(2, 10000)])
        self.assertEqual(estimate(curve, 2), 4)
        self.assertIsNone(fit_curve([(1, .1)] * 100))

    def test_only_missing_published_flow_is_estimated_without_mutating_archive(self):
        rows = s.merge_rows(calibration(), {key(8): '20', key(9): '31'}, {})
        before = repr(rows)
        result = build_estimates(rows)
        self.assertEqual(result['estimates'], [{'date': key(8)[0], 'time': key(8)[1], 'water_cm': 20, 'flow_m3s': .36}])
        self.assertEqual(result['unsupported_hours'], 1)
        self.assertEqual(result['model']['sample_count'], 25)
        self.assertEqual(repr(rows), before)
        filled = s.merge_rows(rows, {}, {key(8): '0.40'})
        self.assertEqual(build_estimates(filled)['estimates'], [])


class FallbackTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.csv = Path(self.temp.name, 'data.csv')
        self.report = Path(self.temp.name, 'report.json')
        s.save_csv(self.csv, calibration())

    def run_sources(self, sources):
        with patch('scraper.local_now', return_value=NOW), patch('scraper.fetch_html', side_effect=sources) as fetch:
            result = s.main(['--csv', str(self.csv), '--report', str(self.report), '--lookback-hours', '3'])
        return result, fetch

    def test_backup_recovers_both_failed_primaries_and_keeps_estimates_separate(self):
        code, fetch = self.run_sources([RuntimeError('500'), RuntimeError('500'), html([key(8)], '20')])
        self.assertEqual(code, 2)
        self.assertEqual(fetch.call_args_list[-1].args, (s.URL_VODOSTAJ_BACKUP,))
        self.assertEqual(s.load_existing(self.csv)[key(8)]['PROTOK'], '')
        estimates = json.loads(self.csv.with_name('flow-estimates.json').read_text())
        self.assertEqual(estimates['estimates'][0]['flow_m3s'], .36)
        self.assertEqual(json.loads(self.report.read_text())['sources']['vodostaj']['status'], 'fallback')
        # On primary recovery, actual Q is authoritative and the old estimate disappears.
        self.run_sources([html([key(8)], '20'), html([key(8)], '0,40')])
        self.assertEqual(s.load_existing(self.csv)[key(8)]['PROTOK'], '0,40')
        self.assertEqual(json.loads(self.csv.with_name('flow-estimates.json').read_text())['estimates'], [])

    def test_stale_primary_uses_fresh_backup_preserving_overlap(self):
        code, _ = self.run_sources([html([key(1)], '20'), html([key(8)], '0,36'), html([key(1), key(8)], '25')])
        self.assertEqual(code, 2)
        rows = s.load_existing(self.csv)
        self.assertEqual(rows[key(1)]['VODOSTAJ'], '20,0')
        self.assertEqual(rows[key(8)]['VODOSTAJ'], '25,0')

    def test_wrong_station_future_or_empty_backup_does_not_touch_archive(self):
        before = self.csv.read_bytes()
        for backup in [html([key(8)]).replace('Maslenjača', 'Druga'), html([key(12)]), html([])]:
            with self.subTest(backup=backup):
                code, _ = self.run_sources([RuntimeError('500'), RuntimeError('500'), backup])
                self.assertEqual(code, 1)
                self.assertEqual(self.csv.read_bytes(), before)

    def test_healthy_primary_never_calls_backup(self):
        code, fetch = self.run_sources([html([key(8)], '20'), html([key(8)], '0,36')])
        self.assertEqual(fetch.call_count, 2)


if __name__ == '__main__':
    unittest.main()
