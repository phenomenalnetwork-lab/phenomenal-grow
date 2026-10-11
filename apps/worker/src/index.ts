// Phase 0 placeholder. BullMQ queues (follow-ups, reminders,
// re-engagement scans) land in Phase 4.
const tick = () => {
  // eslint-disable-next-line no-console
  console.log("pgrow-worker alive (phase 0) — queues arrive in Phase 4");
};

tick();
setInterval(tick, 30_000);
