const fs = require('fs');

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
    fs.writeFileSync('./results/all_tables.json', '[]');
}

module.exports = { readFileIfExists, readProxies, clearResults };
