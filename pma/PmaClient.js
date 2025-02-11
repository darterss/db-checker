const {HttpsProxyAgent} = require("https-proxy-agent");
const axios = require("axios");
const cheerio = require("cheerio");
const logger = require("../utils/logger");
const ini = require("ini");
const fs = require("fs");


process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // отключение проверки ssl
process.removeAllListeners("warning");

// Чтение конфигурации из config.ini
const config = ini.parse(fs.readFileSync('./config.ini', 'utf-8'));
const QUERY_TIMEOUT = parseInt(config.settings.query_timeout, 10) || 20000;
class PmaClient {
    phpMyAdminUrl;
    queryUrl;
    cookie;
    login;
    password;
    token;
    pmaCookieVer;
    pma_collation_connection;
    pmaUser_1;
    pmaAuth_1;
    encodedAuth; // для авторизации при ['auth_type'] = 'http'
    session;
    proxy;
    printInfo;
    htmlData;

    constructor(phpMyAdminUrl, login, password, proxy) {
        this.phpMyAdminUrl = phpMyAdminUrl.endsWith('/') ? phpMyAdminUrl : phpMyAdminUrl + '/';
        this.queryUrl = `${this.phpMyAdminUrl.replace(/index\.php\/?$/, '')}import.php`;
        this.login = login;
        this.password = password;
        this.proxy = proxy;

        const isHTTP = (this.phpMyAdminUrl.split(':')[0].toLowerCase() === 'http');
        this.printInfo = `${this.phpMyAdminUrl}:${this.login}:${this.password}`

        // извлекаем данные прокси
        const [proxyHost, proxyPort, proxyUser, proxyPass] = proxy.split(':');
        this.proxyConfig = {
            host: proxyHost,
            port: proxyPort ? parseInt(proxyPort) : undefined,
            auth: proxyUser && proxyPass ? { username: proxyUser, password: proxyPass } : undefined
        };

        // Формируем прокси-URL
        const proxyUrl = `http://${proxyUser}:${proxyPass}@${proxyHost}:${proxyPort}`;

        // Прокси-агент for https
        const httpsAgent = new HttpsProxyAgent(proxyUrl, {
            //rejectUnauthorized: false // Отключаем проверку SSL для прокси
        });

        // экземпляр axios с прокси
        this.axiosInstance = axios.create({
            validateStatus: () => true, // Игнорируем ошибки ответа
            proxy: isHTTP && this.proxyConfig,
            httpsAgent: httpsAgent, //new https.Agent({ rejectUnauthorized: false }),
            timeout: QUERY_TIMEOUT,
        });
    }

    updateCookies(newCookies) {
        if (!newCookies) return;

        const cookieMap = {
            cookie: ["phpMyAdmin=", "phpMyAdmin_https="],
            pmaCookieVer: ["pmaCookieVer="],
            pma_collation_connection: ["pma_collation_connection="],
            pmaUser_1: ["pmaUser-1=", "pmaUser-1_https="],
            pmaAuth_1: ["pmaAuth-1=", "pmaAuth-1_https="]
        };

        Object.keys(cookieMap).forEach(key => {
            const foundCookie = [...newCookies].reverse().find(cookie =>
                cookieMap[key].some(prefix => cookie.startsWith(prefix))
            );

            if (foundCookie) {
                const cookieValue = foundCookie.split(";")[0];
                if (cookieValue.includes("=deleted")) return;
                this[key] = cookieValue;
            }
        });
        if (typeof this.cookie === 'string') {
            this.session = this.cookie.replace(/phpMyAdmin(_https)?=/, "");
        } else {
            logger.warn(`Куки не получены для ${this.printInfo}, возможно, авторизация не удалась.`);
            this.session = "";
        }

    }

    updateToken(html) {
        const $ = cheerio.load(html);
        const token = $('input[name="token"]').val();
        //console.log('updateToken: ' + token)
        if (!token) throw new Error("Не удалось извлечь токен.");
        this.token = token;
    }

    // === Функция для авторизации при ['auth_type'] = 'cookie' ===
    loginAndGetCookies = async () => {
        try {
            // Запрос к странице входа
            const response = await this.axiosInstance.get(this.phpMyAdminUrl, {
                /*headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Referer": "https://www.google.com/"
                }*/
            });
            // Получаем куки из ответа
            const rawCookies = response.headers["set-cookie"];
            //console.log('raw: ' + rawCookies)
            //console.log(response.status)
            if (rawCookies) {
                this.updateCookies(rawCookies);
                this.htmlData = response.data;
            } else if (!(response.status === 200)) {
                this.phpMyAdminUrl = this.phpMyAdminUrl.replace(/^http:/, "https:");
                this.axiosInstance = axios.create({
                    ...this.axiosInstance.defaults,
                    proxy: false
                });
                const response = await this.axiosInstance.get(this.phpMyAdminUrl, {});
                const rawCookies = response.headers["set-cookie"];
                if (rawCookies) {
                    this.updateCookies(rawCookies);
                    this.htmlData = response.data;
                }
                this.queryUrl = `${this.phpMyAdminUrl.replace(/index\.php\/?$/, '')}import.php`;
                this.printInfo = `${this.phpMyAdminUrl}:${this.login}:${this.password}`
                //console.log(this.phpMyAdminUrl)
                //console.log('raw_after append s: ' + rawCookies)
            } else {
                this.phpMyAdminUrl = this.phpMyAdminUrl.replace(/\/$/, '');
                const response = await this.axiosInstance.get(this.phpMyAdminUrl, {});
                const rawCookies = response.headers["set-cookie"];
                if (rawCookies) {
                    this.updateCookies(rawCookies);
                    this.htmlData = response.data;
                }
                //console.log('raw2: ' + rawCookies)
            }
            //console.log(this.cookie)
            //console.log(this.htmlData)

            // Извлекаем токен из HTML ответа
            this.updateToken(this.htmlData);

            // Отправляем POST-запрос на авторизацию
            const loginResponse = await this.axiosInstance.post(this.phpMyAdminUrl, new URLSearchParams({
                route: "/",
                token: this.token,
                set_session: this.session,
                pma_username: this.login,
                pma_password: this.password,
                server: "1",
            }).toString(), {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent": "Mozilla/5.0",
                    Cookie: this.cookie,
                },
                maxRedirects: 0,
                validateStatus: (status) => true,
            });

            // Обновляем куки
            const newCookies = loginResponse.headers["set-cookie"];
            if (newCookies) {
                this.updateCookies(newCookies)
            }

            // ищем токен в Headers.Location
            const location = loginResponse.headers?.location;
            // Проверяем, есть ли location и является ли он строкой
            if (typeof location === 'string' && location.includes('token=')) {
                const tokenMatch = location.match(/[?&]token=([^&]+)/);
                this.token = tokenMatch ? tokenMatch[1] : undefined;
            } else {
                //если нет в Location - делаем Get запрос
                const response1 = await this.axiosInstance.get(this.phpMyAdminUrl, {
                    headers: {
                        //"User-Agent": "Mozilla/5.0",
                        Cookie: [this.cookie, this.pmaUser_1, this.pmaAuth_1, 'pma_lang=ru']
                            .filter(Boolean)
                            .join("; ")
                    }
                })
                //console.log(response1)
                this.updateToken(response1.data);
                const cookies = response1.headers['set-cookie']
                if (cookies) {
                    this.updateCookies(cookies)
                }
            }
            if (this.pmaAuth_1) {
                logger.info(`Авторизация успешна (${this.printInfo}).`);
            }
            /* console.log(this.phpMyAdminUrl + ' : ' +this.pmaAuth_1)
             console.log(this.phpMyAdminUrl + ' : ' +this.pmaUser_1)
             console.log('\n')*/
            return true;
        } catch (error) {
            logger.error(`❌ Ошибка авторизации (${this.printInfo}) → ${error.message}`);
            return false;
        }
    };

    // === Функция для выполнения SQL-запросов ===
    executeSQLQuery = async (query) => {
        try {
            const response = await this.axiosInstance.post(this.queryUrl, new URLSearchParams({
                token: this.token,
                sql_query: query,
                is_js_confirmed: "0",
                ajax_request: "true",
                _nocache: Date.now(),
                goto: "server_sql.php",
                ajax_page_request: true
            }).toString(), {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
                    Cookie: [this.cookie, this.pmaCookieVer, this.pma_collation_connection, this.pmaUser_1, this.pmaAuth_1]
                        .filter(Boolean)
                        .join("; "),
                    //Authorization: this.encodedAuth, // для авторизации при ['auth_type'] = 'http'
                    "X-Requested-With": "XMLHttpRequest"
                },
            });
            if (!response.data.success) throw Error;
           /* this.updateToken(response.data);
            const cookies = response.headers['set-cookie']
            if (cookies) {
                this.updateCookies(cookies)
            }*/
            // Обрабатываем HTML-ответ
            const $ = cheerio.load(response.data.message);
            return $('table.table_results tbody tr').map((_, row) => {
                return $(row).find('td').first().text().trim();
            }).get();

        } catch (error) {
            logger.error(`❌ Ошибка выполнения SQL-запроса ${query} в ${this.printInfo} → ${error.message}`);
        }
    }
}

module.exports = PmaClient;