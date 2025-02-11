const PmaClient = require("../pma/PmaClient");
const fs = require("fs");
const logger = require("../utils/logger");

async function workerTask(workerData) {
    const { url, login, password, proxy, columnsToFind, whatNeeds } = workerData;
    const client = new PmaClient(url, login, password, proxy);

    if (await client.loginAndGetCookies()) {
        const databases = await client.executeSQLQuery("SHOW DATABASES;");
        const entry = {
            url: url,
            login: login,
            password: password,
            databases: {}
        };
        if (!databases || !Array.isArray(databases)) {
            logger.error(`❌ Ошибка в ${client.phpMyAdminUrl}: databases не массив: ${databases}`);
            return null;
        }

        logger.info(`Найденные базы данных в ${client.phpMyAdminUrl} (${databases.length}): ${databases.join(", ")}`);

        for (const database of databases) {
            // Поиск колонок
            if (whatNeeds === '1' || whatNeeds === 'both') {
                const columnsToSearch = columnsToFind.split(',').map(col => col.trim());
                const likeConditions = columnsToSearch.map(col => `COLUMN_NAME LIKE '%${col}%'`).join(' OR ');
                const foundColumns = await client.executeSQLQuery
                    (`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '${database}' AND (${likeConditions})`)
                if (foundColumns.length > 0) {
                    foundColumns.forEach((column) => {
                        fs.appendFileSync('./results/found_columns.txt', `${url}:${login}:${password}|${column}\n`);
                    });
                }
            }

            // Получение списка таблиц
            if (whatNeeds === '2' || whatNeeds === 'both') {
                const tables = await client.executeSQLQuery(`SHOW TABLES FROM \`${database}\``);
                if (tables.length > 0) {
                    entry.databases[database] = tables; // Добавляем таблицы в базу данных
                }
            }
        }
        // Если найдены таблицы, возвращаем результат
        if (Object.keys(entry.databases).length > 0) {
            return entry;
        }
    }
    return null;
}

module.exports = workerTask;