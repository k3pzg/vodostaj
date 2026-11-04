"""Optional end-to-end checks: pip install playwright; playwright install chromium."""
import os
import threading
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
CSV = ('\ufeffDATUM;VRIJEME;VODOSTAJ;PROTOK\n'
       + '\n'.join(f'01.11.2026;{hour:02d}:00;20,0;0,36' for hour in range(24))
       + '\n02.11.2026;00:00;20,0;0,36\n02.11.2026;01:00;23,0;0,51\n'
       + '02.11.2026;14:00;28,0;0,79\n02.11.2026;15:00;29,0;\n')


class QuietHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        # Downloads may bypass Playwright request interception; serve the same
        # full fixture at the direct dataset URL as the mocked CSV fetch.
        if self.path == '/vodostaj_protok.csv':
            body = CSV.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/csv; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            super().do_GET()

    def log_message(self, *_):
        pass


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{server.server_port}/dashboard.html'
    try:
        with sync_playwright() as p:
            executable = os.environ.get('CHROMIUM_PATH')
            browser = p.chromium.launch(headless=True, **({'executable_path': executable} if executable else {}))
            errors = []
            for width, zone in [(1440, 'America/New_York'), (390, 'Asia/Tokyo'), (320, 'Europe/Zagreb')]:
                ctx = browser.new_context(viewport={'width': width, 'height': 1000}, timezone_id=zone, accept_downloads=True)
                page = ctx.new_page()
                page.clock.install(time=datetime(2026, 11, 3, 12, tzinfo=timezone.utc))
                page.on('pageerror', lambda error: errors.append(str(error)))
                ctx.route('**/vodostaj_protok.csv*', lambda route: route.fulfill(status=200, body=CSV))
                page.route('**/scrape-status.json?*', lambda route: route.fulfill(status=200, json={
                    'checked_at': '2026-11-03T12:00:00+01:00', 'status': 'degraded',
                    'source_errors': {'protok': 'offline'},
                    'sources': {'vodostaj': {'status': 'stale'}},
                }))
                page.goto(url)
                page.wait_for_function("document.getElementById('water-value').textContent === '29,0'")
                assert page.locator('#status-title').inner_text() == 'Izvor kasni s mjerenjima'
                assert '15:00' in page.locator('#water-time').inner_text()
                assert '14:00' in page.locator('#flow-time').inner_text()
                assert 'protok' in page.locator('#collection-status').inner_text()
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                assert page.locator('#page-title').inner_text() == 'Ilova - Mjerna postaja Maslenjača'
                assert page.get_by_text('Vodostaj i protok Ilove. Jasna slika onoga što je izmjereno.').count() == 0
                assert '28 satnih zapisa' in page.locator('#dataset-summary').inner_text()
                page.locator('#presets button[data-hours="24"]').click()
                page.locator('#anchor').check()
                page.locator('#incomplete').check()
                with page.expect_download() as dataset_event:
                    page.locator('#download-dataset').click()
                assert dataset_event.value.suggested_filename == 'ilova-maslenjaca-cijeli-dataset.csv'
                dataset_text = Path(dataset_event.value.path()).read_text(encoding='utf-8-sig')
                assert dataset_text == CSV.lstrip('\ufeff'), (len(dataset_text), len(CSV), dataset_text[:120])
                page.locator('#show-archive').click()
                assert not page.locator('#incomplete').is_checked()
                assert not page.locator('#anchor').is_checked()
                assert page.locator('#presets button[data-hours="0"]').get_attribute('aria-pressed') == 'true'
                assert 'ukupno 28 zapisa' in page.locator('#archive-scope').inner_text()
                assert 'Odabrana je cijela arhiva.' in page.locator('#archive-scope').inner_text()
                page.select_option('#table-sort','asc')
                assert '01.11.2026' in page.locator('#table-body tr').first.inner_text()
                page.locator('#presets button[data-hours="24"]').click()
                page.locator('#incomplete').check()
                page.locator('#show-archive-table').click()
                assert not page.locator('#incomplete').is_checked()
                assert page.locator('#table-sort').input_value() == 'desc'
                page.locator('#next-page').click()
                assert page.locator('#page-label').inner_text() == '2 / 2'
                with page.expect_download() as event:
                    page.locator('#export').click()
                assert event.value.suggested_filename.endswith('.csv')
                assert Path(event.value.path()).read_text(encoding='utf-8-sig').count('\n') == 29
                page.select_option('#aggregation', 'daily')
                page.locator('#theme').click()
                page.locator('#incomplete').check()
                assert '1–1 od 1' in page.locator('#table-count').inner_text()
                page.locator('#incomplete').uncheck()
                page.fill('#date-from', '2026-11-03'); page.fill('#date-to', '2026-11-03')
                page.locator('#date-form button').click()
                assert page.locator('#empty-state').is_visible()
                assert page.locator('#export').is_disabled()
                assert page.locator('#water-value').inner_text() == '29,0'
                page.fill('#date-from', '2026-11-02'); page.fill('#date-to', '2026-11-01')
                page.locator('#date-form button').click()
                assert page.locator('#filter-error').is_visible()
                page.locator('#presets button[data-hours="24"]').click()
                page.locator('#anchor').check()
                assert not page.locator('#empty-state').is_visible()
                page.route('**/vodostaj_protok.csv*', lambda route: route.abort())
                page.locator('#refresh').click()
                page.wait_for_function("document.getElementById('status-title').textContent === 'Osvježavanje nije uspjelo'")
                assert page.locator('#water-value').inner_text() == '29,0'
                print(f'PASS: viewport={width}, timezone={zone}, filters/export/table/theme/failure')
                ctx.close()
            # First-load failure must permit retry and must never show green status.
            ctx = browser.new_context()
            page = ctx.new_page()
            page.route('**/vodostaj_protok.csv*', lambda route: route.fulfill(status=503, body='offline'))
            page.route('**/scrape-status.json?*', lambda route: route.fulfill(status=404, body='missing'))
            page.goto(url)
            page.wait_for_function("document.getElementById('status-title').textContent === 'Podaci trenutačno nisu dostupni'")
            assert not page.locator('#refresh').is_disabled()
            assert page.locator('#export').is_disabled()
            page.route('**/vodostaj_protok.csv*', lambda route: route.fulfill(status=200, body=CSV))
            page.locator('#refresh').click()
            page.wait_for_function("document.getElementById('water-value').textContent === '29,0'")
            # Isolated points must remain visible even when dense charts hide regular dots.
            large_csv = CSV + ''.join(f'\n{day:02d}.10.2026;{hour:02d}:00;20,0;0,36' for day in range(27, 32) for hour in range(24))
            page.route('**/vodostaj_protok.csv*', lambda route: route.fulfill(status=200, body=large_csv))
            page.locator('#refresh').click()
            page.wait_for_function("!document.getElementById('refresh').disabled")
            page.locator('#presets button[data-hours="0"]').click()
            assert page.evaluate("""() => {
                const chart = Chart.getChart('chart-flow');
                const data = chart.data.datasets[0].data;
                return data.length > 100 && chart.getDatasetMeta(0).data.at(-2).options.radius > 0;
            }""")
            assert not errors, errors
            print('PASS: initial failure and recovery; no JavaScript errors')
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
