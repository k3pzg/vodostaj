import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import requests
import scraper as s

NOW = datetime(2026, 10, 22, 8, 30, tzinfo=s.LOCAL_ZONE)


def key(hour, day=22):
    return (f'{day:02d}.10.2026', f'{hour:02d}:00')


def html(keys, value='11'):
    rows = ''.join(f'<tr><td></td><td>{d}</td><td>{t}</td><td>{value}</td><td>0</td></tr>' for d, t in keys)
    return '<table id="example"><tbody><tr><td></td><td colspan="4">Ilova - Maslenjača</td></tr>' + rows + '</tbody></table>'


class ParserTests(unittest.TestCase):
    def test_real_table_shape_and_both_date_formats(self):
        data = s.parse_table(html([('22.10.26.', '08:00'), ('22.10.2026', '07:00')]), 'vodostaj')
        self.assertEqual(data, {key(8): '11,0', key(7): '11,0'})
        self.assertEqual(s.parse_table(html([key(8)], '0,08'), 'protok')[key(8)], '0,08')

    def test_invalid_source_is_not_success(self):
        cases = ['', '<table id="example"></table>', html([]), html([('31.02.26.', '08:00')]),
                 html([('22.10.26.', '25:00')]), html([key(8)], '-'),
                 html([key(8)], 'NaN'), html([key(8)], 'inf'),
                 html([('22.10.26.', '08:15')]),
                 '<table id="example"><tbody><tr><td>changed layout</td></tr></tbody></table>']
        for text in cases:
            with self.subTest(text=text), self.assertRaises(ValueError):
                s.parse_table(text, 'vodostaj')

    def test_conflicting_duplicates_fail(self):
        text = html([key(8)]).replace('</tbody>', html([key(8)], '12').split('<tbody>')[1].split('</tbody>')[0] + '</tbody>')
        with self.assertRaises(ValueError):
            s.parse_table(text, 'vodostaj')

    @patch('scraper.time.sleep')
    @patch('scraper.requests.get', side_effect=requests.Timeout('timeout'))
    def test_exhausted_http_retries_raise(self, get, sleep):
        with self.assertRaises(RuntimeError):
            s.fetch_html('https://example.invalid', retries=3)
        self.assertEqual(get.call_count, 3)
        self.assertEqual(sleep.call_count, 2)

    @patch('scraper.time.sleep')
    @patch('scraper.requests.get')
    def test_http_error_can_recover(self, get, sleep):
        from unittest.mock import Mock
        good = Mock(text='valid')
        get.side_effect = [requests.HTTPError('503'), good]
        self.assertEqual(s.fetch_html('https://example.invalid'), 'valid')
        self.assertEqual(get.call_count, 2)


class QualityTests(unittest.TestCase):
    def test_partial_rows_are_preserved_then_completed(self):
        merged = s.merge_rows({}, {key(7): '12,0', key(8): '11,0'}, {key(8): '0,08'})
        self.assertEqual(merged[key(7)]['PROTOK'], '')
        filled = s.merge_rows(merged, {}, {key(7): '0,09'})
        self.assertEqual(filled[key(7)]['VODOSTAJ'], '12,0')
        self.assertEqual(filled[key(7)]['PROTOK'], '0,09')
        self.assertEqual(merged[key(7)]['PROTOK'], '')

    def test_internal_partial_and_trailing_gaps(self):
        rows = s.merge_rows({}, {key(2): '11,0', key(4): '11,0'}, {key(2): '0,08'})
        report = s.audit_rows(rows, NOW, lookback_hours=6)
        self.assertEqual(report['missing']['VODOSTAJ'], ['22.10.2026 03:00', '22.10.2026 05:00'])
        self.assertIn('22.10.2026 04:00', report['missing']['PROTOK'])
        self.assertIn('VODOSTAJ', report['freshness_errors'])

    def test_fresh_duplicate_run_is_ok_without_new_data(self):
        s.check_freshness({key(8): '11,0'}, NOW, 3)
        # UTC host clock and Croatian clock must produce identical ages.
        self.assertEqual(s.age_hours(key(8), NOW), s.age_hours(key(8), NOW.astimezone(timezone.utc)))
        with self.assertRaises(ValueError):
            s.check_freshness({key(4): '11,0'}, NOW, 3)
        with self.assertRaises(ValueError):
            s.check_freshness({key(12): '11,0'}, NOW, 3)

    def test_spring_dst_has_no_false_gap(self):
        now = datetime(2026, 3, 29, 6, tzinfo=s.LOCAL_ZONE)
        keys = [('29.03.2026', f'{h:02d}:00') for h in (0, 1, 3, 4, 5, 6)]
        rows = s.merge_rows({}, dict.fromkeys(keys, '11,0'), dict.fromkeys(keys, '0,08'))
        self.assertFalse(any(s.audit_rows(rows, now, lookback_hours=5)['missing'].values()))

    def test_fall_dst_does_not_invent_duplicate_hour(self):
        now = datetime(2026, 10, 25, 6, tzinfo=s.LOCAL_ZONE)
        keys = [key(h, day=25) for h in range(7)]
        rows = s.merge_rows({}, dict.fromkeys(keys, '11,0'), dict.fromkeys(keys, '0,08'))
        self.assertFalse(any(s.audit_rows(rows, now, lookback_hours=7)['missing'].values()))


class CommandTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.csv = Path(self.temp.name, 'data.csv')
        self.report = Path(self.temp.name, 'report.json')
        self.args = ['--csv', str(self.csv), '--report', str(self.report), '--lookback-hours', '3']
        s.save_csv(self.csv, s.merge_rows({}, dict.fromkeys([key(5), key(6), key(7), key(8)], '11,0'), dict.fromkeys([key(5), key(6), key(7), key(8)], '0,08')))

    def run_main(self, sources=None, extra=None):
        with patch('scraper.local_now', return_value=NOW), patch('scraper.fetch_html', side_effect=sources):
            return s.main(self.args + (extra or []))

    def test_fresh_unchanged_csv_success(self):
        keys = [key(h) for h in range(5, 9)]
        self.assertEqual(self.run_main([html(keys), html(keys, '0,08')]), 0)
        self.assertEqual(json.loads(self.report.read_text())['new_rows'], 0)

    def test_fetch_parse_or_stale_error_preserves_csv_bytes(self):
        before = self.csv.read_bytes()
        for sources in ([RuntimeError('offline')], ['bad html'], [html([key(1)])]):
            with self.subTest(sources=sources):
                self.assertEqual(self.run_main(sources), 1)
                self.assertEqual(self.csv.read_bytes(), before)
                self.assertEqual(json.loads(self.report.read_text())['status'], 'error')

    def test_valid_observations_saved_despite_gaps(self):
        self.csv.unlink()
        self.assertEqual(self.run_main([html([key(5), key(7), key(8)]), html([key(5), key(8)], '0,08')]), 2)
        rows = s.load_existing(self.csv)
        self.assertNotIn(key(6), rows)
        self.assertEqual(rows[key(7)]['VODOSTAJ'], '11,0')
        self.assertEqual(rows[key(7)]['PROTOK'], '')
        self.assertEqual(json.loads(self.report.read_text())['status'], 'degraded')

    def test_check_does_not_fetch_or_write_csv(self):
        before = self.csv.read_bytes()
        self.assertEqual(self.run_main(extra=['--check']), 0)
        self.assertEqual(self.csv.read_bytes(), before)

    def test_corrupt_csv_rejected(self):
        self.csv.write_text('wrong;headers\n')
        self.assertEqual(self.run_main(extra=['--check']), 1)

    def test_failed_replace_keeps_original(self):
        before = self.csv.read_bytes()
        with patch('scraper.os.replace', side_effect=OSError('disk error')), self.assertRaises(OSError):
            s.save_csv(self.csv, {})
        self.assertEqual(self.csv.read_bytes(), before)
        self.assertEqual(sorted(p.name for p in self.csv.parent.iterdir()), ['data.csv'])


if __name__ == '__main__':
    unittest.main()
