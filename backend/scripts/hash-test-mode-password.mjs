#!/usr/bin/env node
/**
 * Print the bcrypt hash to store in TEST_MODE_PASSWORD_HASH.
 *
 * The password is read from stdin (hidden when typed in a terminal, or piped),
 * never from a command-line argument, so it does not end up in shell history
 * or the process list. Only the printed hash goes into the server
 * configuration; the password itself is shared with testers out of band.
 *
 * Usage: npm run hash-test-password
 */
import bcrypt from 'bcrypt';

/** Cost factor; matches the backend's SALT_ROUNDS for user passwords. */
const COST = 10;

/** Read one line from stdin, without echoing it when stdin is a terminal. */
const readPassword = () =>
  new Promise((resolve) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) {
      let data = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (chunk) => (data += chunk));
      stdin.on('end', () => resolve(data.replace(/\r?\n$/, '')));
      return;
    }
    stdout.write('Test password: ');
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (char) => {
      if (char === '\r' || char === '\n') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off('data', onData);
        stdout.write('\n');
        resolve(value);
      } else if (char === '\u0003') {
        process.exit(130);
      } else if (char === '\u007f') {
        value = value.slice(0, -1);
      } else {
        value += char;
      }
    };
    stdin.on('data', onData);
  });

const password = await readPassword();
if (password.length < 12) {
  console.error('Use at least 12 characters for the shared test password.');
  process.exit(1);
}
const hash = await bcrypt.hash(password, COST);
console.log(`TEST_MODE_PASSWORD_HASH='${hash}'`);
