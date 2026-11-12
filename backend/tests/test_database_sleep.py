"""The free Neon database sleeps after 5 idle minutes. The app must not keep it awake when nobody is using it."""
from app.database import connect_pool
from app.reminders import check_every


def test_reminders_are_checked_every_15_minutes_with_daily_reminders(monkeypatch):
    monkeypatch.delenv("ASTRA_REMINDER_MINUTES", raising=False)
    assert check_every() == 15 * 60  # longer than Neon's 5 idle minutes, so it can sleep in between


def test_a_short_demo_interval_is_still_checked_often(monkeypatch):
    monkeypatch.setenv("ASTRA_REMINDER_MINUTES", "2")
    assert check_every() == 30  # a quarter of the interval: demo reminders still arrive on time


def test_the_pool_keeps_no_connection_open_when_idle(database):
    pool = connect_pool(database)
    try:
        assert pool.min_size == 0  # an always-open connection could keep the database awake
        assert pool.max_idle < 5 * 60  # unused connections close before Neon's 5 idle minutes
        with pool.connection() as connection:
            assert connection.execute("SELECT 1").fetchone()[0] == 1
    finally:
        pool.close()


def test_unused_connections_close_within_two_minutes(database):
    pool = connect_pool(database)
    try:
        assert pool.max_idle <= 60  # shrinking runs on a fixed tick, so a connection can live up to 2 ticks
    finally:
        pool.close()


def test_a_connection_dropped_while_the_database_slept_is_replaced(database):
    import psycopg
    pool = connect_pool(database)
    try:
        with pool.connection() as connection:
            pid = connection.info.backend_pid
        with psycopg.connect(database, autocommit=True) as admin:  # what a sleeping database does to open connections
            admin.execute("SELECT pg_terminate_backend(%s)", (pid,))
        with pool.connection() as connection:
            assert connection.execute("SELECT 1").fetchone()[0] == 1
    finally:
        pool.close()


def run_loop(monkeypatch, results, wait_for):
    """Run the reminder loop with a fake check that returns `results` in turn; return the times it was called."""
    import asyncio
    import threading
    import time
    from app import reminders

    calls = []
    def fake_check(storage, sender, stop):
        calls.append(time.monotonic())
        return results[min(len(calls), len(results)) - 1]
    monkeypatch.setattr(reminders, "send_due_reminders", fake_check)
    monkeypatch.setattr(reminders, "check_every", lambda: 3600.0)  # the next regular check is an hour away

    async def main():
        stop = threading.Event()
        loop = asyncio.ensure_future(reminders.reminder_loop(None, None, stop))
        deadline = time.monotonic() + 5
        while len(calls) < wait_for and time.monotonic() < deadline:
            await asyncio.sleep(0.05)
        stop.set()
        loop.cancel()
        try:
            await loop
        except asyncio.CancelledError:
            pass
    start = time.monotonic()
    asyncio.run(main())
    return [t - start for t in calls]


def test_after_a_full_batch_the_loop_checks_again_at_once(monkeypatch):
    from app import reminders
    monkeypatch.setattr(reminders, "FIRST_CHECK", 0.0)
    calls = run_loop(monkeypatch, [reminders.BATCH, 3], wait_for=2)
    assert len(calls) == 2  # more may be due: the second check didn't wait an hour


def test_the_first_check_comes_soon_after_a_start_or_deploy(monkeypatch):
    from app import reminders
    assert reminders.FIRST_CHECK <= 30
    monkeypatch.setattr(reminders, "FIRST_CHECK", 0.1)
    calls = run_loop(monkeypatch, [0], wait_for=1)
    assert len(calls) == 1 and calls[0] < 2  # not the regular hour
