'use strict';

const cron = require('node-cron');

/**
 * Tâches planifiées. Chaque tâche est une fonction (db, now) testable seule ;
 * ce fichier ne fait que les brancher sur node-cron.
 */
const JOBS = [];

function startJobs(db, log = console) {
  const tasks = JOBS.map(({ name, schedule, run }) =>
    cron.schedule(schedule, () => {
      try {
        const result = run(db, new Date());
        if (result && Object.values(result).some(Boolean)) log.log(`[job ${name}]`, result);
      } catch (err) {
        log.error(`[job ${name}] échec`, err);
      }
    })
  );
  log.log(`${tasks.length} tâche(s) planifiée(s) démarrée(s)`);
  return tasks;
}

module.exports = { startJobs, JOBS };
