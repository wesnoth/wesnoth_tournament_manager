// Exercise the real progression service with an in-memory SQL adapter. Imports
// are isolated so this regression test cannot connect to a database or Discord.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/tournament-engine/competitionProgression.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

async function scenario(order, otherGroupActive) {
  const rounds = [1, 2, 3].map(number => ({ id: String(number), status: 'in_progress', seriesStatus: 'ready' }));
  let current;
  let groupStatus = 'in_progress';
  const notifications = [];
  let rollbacks = 0;
  let phasesCompleted = 0;
  let phasesCompiled = 0;
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() { rollbacks++; }, release() {},
    async execute(statement, args = []) {
      const sql = statement.replace(/\s+/g, ' ').trim();
      if (sql.startsWith('SELECT id FROM tournaments')) return [[{ id: 't' }]];
      if (sql.startsWith('SELECT games.*')) {
        current = rounds.find(round => round.id === args[0]);
        return [[{ id: current.id, status: current.seriesStatus === 'completed' ? 'completed' : 'pending',
          series_id: current.id, round_id: current.id, round_number: Number(current.id), group_id: 'g',
          phase_id: 'p', format: 'round_robin', entry1_id: 'a', entry2_id: 'b' }]];
      }
      if (sql.startsWith('SELECT * FROM tournament_series')) return [[{ wins_required: 1, entry1_wins: 1, entry2_wins: 0 }]];
      if (sql.startsWith('SELECT scoring.')) return [[{ win_points: 1, loss_points: 0 }]];
      if (sql.startsWith("UPDATE tournament_series SET status = 'completed'")) current.seriesStatus = 'completed';
      if (sql.startsWith('SELECT target.id')) return [[]];
      if (sql.startsWith('SELECT COUNT(*) AS count FROM tournament_series')) return [[{ count: current.seriesStatus === 'completed' ? 0 : 1 }]];
      if (sql.startsWith("UPDATE tournament_phase_rounds SET status = 'completed'")) current.status = 'completed';
      if (sql.startsWith('SELECT entry_id, matches_played, points')) return [[{ entry_id: 'a', points: 1, matches_played: 1 }, { entry_id: 'b', points: 0, matches_played: 1 }]];
      if (sql.startsWith('SELECT series.id,') || sql.startsWith('SELECT games.entry1_id')) return [[]];
      if (sql.startsWith('SELECT standings.entry_id')) return [[{ entry_id: 'a' }, { entry_id: 'b' }]];
      if (sql.startsWith('SELECT id, best_of FROM tournament_phase_rounds')) {
        const next = rounds.find(round => Number(round.id) === args[1]);
        return [[...(next && (!sql.includes("status = 'pending'") || next.status === 'pending') ? [next] : [])]];
      }
      if (sql.startsWith("UPDATE tournament_phase_rounds SET status = 'in_progress'")) {
        const next = rounds.find(round => round.id === args[0]);
        if (!sql.includes("AND status = 'pending'") || next.status === 'pending') next.status = 'in_progress';
      }
      if (sql.startsWith('SELECT COUNT(*) AS count FROM tournament_phase_rounds')) return [[{ count: rounds.filter(round => !['completed', 'cancelled'].includes(round.status)).length }]];
      if (sql.startsWith("UPDATE tournament_phase_groups SET status = 'completed'")) groupStatus = 'completed';
      // Phase completion must also wait for every other group.
      if (sql.startsWith('SELECT COUNT(*) AS count FROM tournament_phase_groups')) return [[{ count: otherGroupActive || groupStatus !== 'completed' ? 1 : 0 }]];
      if (sql.startsWith('SELECT g.status')) return [[{ status: groupStatus, phase_status: 'in_progress', format: 'round_robin' }]];
      if (sql.startsWith('UPDATE ')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const exports = {};
  const dependencies = {
    crypto: require('node:crypto'),
    '../config/database.js': { pool: { getConnection: async () => connection } },
    '../services/tournamentPhaseDiscordService.js': {
      notifyRoundStandings: async (_, id) => notifications.push(id),
      notifyPhaseCompleted: async () => { phasesCompleted++; },
      notifyTournamentFinished: async () => assert.fail('Tournament closed prematurely'),
    },
    './competitionCompiler.js': { compileNextPhaseCompetition: async () => { phasesCompiled++; return true; } },
  };
  vm.runInNewContext(compiled, { exports, require: name => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  } });
  await exports.recalculateGroupStandings('t', 'g');
  assert.equal(notifications.length, 0, 'Manual recalculation must not notify');
  assert.ok(rounds.every(round => round.status === 'in_progress'), 'Manual recalculation must not progress rounds');
  for (const [index, number] of order.entries()) {
    await exports.recordPhaseGameResult('t', String(number), 'a');
    assert.equal(groupStatus, index === order.length - 1 ? 'completed' : 'in_progress');
    const expectedPhases = !otherGroupActive && index === order.length - 1 ? 1 : 0;
    assert.equal(phasesCompleted, expectedPhases);
    assert.equal(phasesCompiled, expectedPhases);
    for (const finished of order.slice(0, index + 1)) assert.equal(rounds[finished - 1].status, 'completed', 'Completed rounds must never reopen');
  }
  assert.deepEqual(notifications, order.map(String));
  await assert.rejects(() => exports.recalculateGroupStandings('t', 'g'), /Only active/);
  assert.equal(rollbacks, 1);
}
async function notificationsScenario() {
  const serviceSource = fs.readFileSync(path.join(__dirname, '../src/services/tournamentPhaseDiscordService.ts'), 'utf8');
  const serviceCode = ts.transpileModule(serviceSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  const messages = [];
  let delivered = true;
  const dependencies = {
    '../config/database.js': { query: async sql => {
      if (sql.includes('SELECT r.group_id')) return { rows: [{ group_id: 'g', round_number: 3 }] };
      if (sql.includes('SELECT tournaments.discord_thread_id')) return { rows: [{ discord_thread_id: 'thread', phase_name: 'League', group_name: 'Group 2' }] };
      if (sql.includes('SELECT standings.rank_position')) return { rows: [{ rank_position: 1, entry_name: 'Player', points: 2, wins: 2, losses: 0, omp: 50, gwp: 100, ogp: 50 }] };
      throw new Error(`Unexpected notification query: ${sql}`);
    } },
    './discordService.js': { default: { publishDiscordMessage: async (thread, message) => {
      assert.equal(thread, 'thread');
      messages.push(message);
      return delivered;
    } } },
  };
  vm.runInNewContext(serviceCode, { exports, console, require: name => {
    assert.ok(name in dependencies);
    return dependencies[name];
  } });
  await exports.notifyRoundStandings('t', 'r');
  assert.equal(messages[0].embeds[0].title, '✅ League · Group 2 · Round 3');
  assert.equal(messages[0].embeds[0].footer.text, 'Standings after round 3');
  assert.equal(await exports.publishGroupStandings('t', 'g'), true);
  assert.equal(messages[1].embeds[0].footer.text, 'Current group standings · Organizer notification');
  delivered = false;
  assert.equal(await exports.publishGroupStandings('t', 'g'), false, 'Manual delivery must expose failure');
}

(async () => {
  for (const order of [[1,2,3], [1,3,2], [2,1,3], [2,3,1], [3,1,2], [3,2,1]]) {
    await scenario(order, true);
    await scenario(order, false);
  }
  await notificationsScenario();
  console.log('Group progression: all six completion orders and manual recalculation guards passed (no external services).');
})().catch(error => { console.error(error); process.exitCode = 1; });
