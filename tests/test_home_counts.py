"""Run with: python -m unittest discover -s tests -v."""
import re
import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / 'functions/api/[[path]].js').read_text()


class HomeCountsTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.executescript((ROOT / 'migrations/0001_init.sql').read_text())
        self.db.executemany('INSERT INTO events(id,name,start_date,end_date,active) VALUES(?,?,?, ?,?)',
                            [('live', 'Live', '2026-10-07', '2026-10-07', 1),
                             ('old', 'Old', '2026-10-06', '2026-10-06', 0)])
        self.db.executemany('INSERT INTO meals(id,event_id,meal_date,meal_type,active) VALUES(?,?,?,?,?)',
                            [('lunch', 'live', '2026-10-07', '午餐', 1),
                             ('dinner', 'live', '2026-10-07', '晚餐', 1),
                             ('disabled', 'live', '2026-10-07', '特餐', 0),
                             ('old-meal', 'old', '2026-10-06', '午餐', 1)])
        self.db.executemany('INSERT INTO people(id,name) VALUES(?,?)', [('a', 'A'), ('b', 'B')])

    def order(self, meal, person='a', active=1, qty=1):
        event = self.db.execute('SELECT event_id FROM meals WHERE id=?', (meal,)).fetchone()[0]
        self.db.execute('INSERT INTO orders(id,meal_id,event_id,person_id,meal_menu_id,name,active,qty,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
                        (str(self.db.total_changes), meal, event, person, 'item', 'Food', active, qty, '2026-10-07'))

    def count(self, name):
        # Execute the actual production SQL against SQLite (D1's SQL engine).
        sql = re.search(r'counts\.' + name + r"=\(await env\.DB\.prepare\((['`])(.*?)\1\)", SOURCE, re.S)[2]
        return self.db.execute(sql).fetchone()[0]

    def test_only_active_events(self):
        self.assertEqual(self.count('events'), 1)
        self.db.execute('UPDATE events SET active=0')
        self.assertEqual(self.count('events'), 0)

    def test_distinct_people_per_meal_not_items_or_quantities(self):
        self.order('lunch', qty=3)
        self.order('lunch', qty=2)
        self.order('lunch', person='b')
        self.order('dinner')
        self.assertEqual(self.count('orders'), 3)

    def test_disabled_events_meals_and_cancelled_orders_excluded(self):
        self.order('old-meal')
        self.order('disabled')
        self.order('lunch', active=0)
        self.assertEqual(self.count('orders'), 0)
        self.order('lunch')
        self.assertEqual(self.count('orders'), 1)
        self.db.execute("UPDATE events SET active=0 WHERE id='live'")
        self.assertEqual(self.count('orders'), 0)

    def test_empty_orders(self):
        self.assertEqual(self.count('orders'), 0)

    def test_home_labels(self):
        ui = (ROOT / 'public/app.js').read_text()
        self.assertIn('${r.counts.events}</b><span>進行中活動</span>', ui)
        self.assertIn('${r.counts.orders}</b><span>訂餐人次</span>', ui)


if __name__ == '__main__':
    unittest.main()
