const fs = require('fs');
const readline = require("readline");

// Чтение прокси из файла
function readProxies(filename) {
    if (fs.existsSync(filename)) {
        return fs.readFileSync(filename, 'utf-8')
            .split('\n')
            .map(line => line.trim())
            .filter(line => line);
    }
    return [];
}

// Чтение данных из файла
function readFileIfExists(filename) {
    if (fs.existsSync(filename)) {
        return new Set(
            fs.readFileSync(filename, 'utf-8')
                .split('\n')
                .map(line => line.trim())
                .filter(line => line)
        );
    }
    return new Set();
}

function clearResults() {
    if (!fs.existsSync('results')) fs.mkdirSync('results', { recursive: true });
    fs.writeFileSync('./results/found_columns.txt', '');
    fs.writeFileSync('./results/all_tables.json', '');
    fs.writeFileSync('./results/all_tables.txt', '');
    fs.writeFileSync('./logs/app.log', '');
}

function countLines(filePath) {
    return new Promise((resolve, reject) => {
        let lineCount = 0;
        const rl = readline.createInterface({
            input: fs.createReadStream(filePath),
            output: process.stdout,
            terminal: false
        });

        rl.on('line', () => {
            lineCount++;
        });

        rl.on('close', () => {
            resolve(lineCount);
        });

        rl.on('error', (err) => {
            reject(err);
        });
    });
}

module.exports = { readFileIfExists, readProxies, clearResults, countLines };
