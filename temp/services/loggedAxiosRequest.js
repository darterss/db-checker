const fs = require("fs");
const path = require("path");
const axios = require("axios");

// === Функция для записи логов в logs/axios.log ===
function logToFile(message) {
    const logDir = path.join(__dirname, "..", "logs");
    const logFile = path.join(logDir, "loggedAxiosRequest.log");

    // Создаём папку logs, если её нет
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }

    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;

    fs.appendFileSync(logFile, logMessage, "utf8");
}

// === Функция для логирования запросов и ответов ===
async function loggedAxiosRequest(config) {
    try {
        logToFile(`➡️ Запрос: ${config.method.toUpperCase()} ${config.url}`);
        if (config.data) logToFile(`📤 Данные: ${JSON.stringify(config.data)}`);

        const response = await axios(config);

        logToFile(`✅ Ответ [${response.status}]: ${JSON.stringify(response.data).substring(0, 500)}`);
        return response;
    } catch (error) {
        logToFile(`❌ Ошибка: ${error.message}`);
        if (error.response) {
            logToFile(`📥 Ответ сервера [${error.response.status}]: ${JSON.stringify(error.response.data).substring(0, 500)}`);
        }
        throw error;
    }
}


loggedAxiosRequest.get = (url, config = {}) => loggedAxiosRequest({ ...config, method: "get", url });
loggedAxiosRequest.post = (url, data, config = {}) => loggedAxiosRequest({ ...config, method: "post", url, data });


module.exports = loggedAxiosRequest;
