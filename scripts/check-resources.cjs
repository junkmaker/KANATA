const { existsSync } = require('fs');
const { join } = require('path');

module.exports = async function checkResources() {
  const root       = join(__dirname, '..');
  const pyExe      = join(root, 'resources', 'python', 'python.exe');
  const backendSrc = join(root, 'resources', 'backend', 'src', 'main.py');

  if (!existsSync(pyExe)) {
    throw new Error(
      '[beforeBuild] resources/python/python.exe not found.\n' +
      'Run: npm run prepare:dist'
    );
  }
  if (!existsSync(backendSrc)) {
    throw new Error(
      '[beforeBuild] resources/backend/src/main.py not found.\n' +
      'Run: npm run prepare:dist'
    );
  }
  console.log('[beforeBuild] resources OK');
};
