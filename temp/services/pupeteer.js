const puppeteer = require("puppeteer");

(async () => {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();

    // **Перехват всех запросов**
    page.on("request", async request => {
        const url = request.url();
        const type = request.resourceType();

        if (type === "document" || type === "xhr") {
            console.log(`📤 [${type.toUpperCase()}] Запрос:`, url);
            console.log("🔹 Метод:", request.method());
            console.log("🔹 Заголовки:", request.headers());

            // ⚡ Достаём куки вручную через page.cookies()
            const cookies = await page.cookies();
            console.log("🍪 Куки запроса:", cookies.map(c => `${c.name}=${c.value}`).join("; "));

            if (["POST", "PUT", "PATCH"].includes(request.method())) {
                console.log("🔹 Данные:", request.postData());
            }
        }
    });

    // **Перехват всех ответов**
    page.on("response", async response => {
        const url = response.url();
        const type = response.request().resourceType();

        if (type === "document" || type === "xhr") {
            console.log(`📥 [${type.toUpperCase()}] Ответ:`, url);
            console.log("🔹 Статус:", response.status());

            // Ловим куки из заголовков ответа
            const setCookies = response.headers()["set-cookie"];
            if (setCookies) {
                console.log("🍪 `Set-Cookie` заголовок:", setCookies);
            }

            try {
                const text = await response.text();
                console.log("🔹 Данные:", text.slice(0, 500));
            } catch (e) {
                console.log("🔹 Ошибка чтения ответа:", e.message);
            }
        }
    });

    // Открываем страницу
    await page.goto("https://pma.maxcluster.net/c-1474/", { waitUntil: "networkidle2" });

    // Логинимся
    await page.waitForSelector('input[name="pma_username"]');
    await page.type('input[name="pma_username"]', "db-user-1");
    await page.type('input[name="pma_password"]', "TkKYesSFfPCunxMgzvXR");

    await Promise.all([
        page.click('input[type="submit"]'),
        page.waitForNavigation({ waitUntil: "networkidle2" })
    ]);

    // **Проверяем куки после логина**
    const cookiesAfterLogin = await page.cookies();
    console.log("🍪 Куки после логина:", cookiesAfterLogin.map(c => `${c.name}=${c.value}`).join("; "));

    await new Promise(resolve => setTimeout(resolve, 10000));
    await browser.close();
})();
