/*
////////////////////////////////////////////////////////////////////////////////// временно, удалить
async checkProxy() {
    try {
        const s = (this.phpMyAdminUrl.split(':')[0].toLowerCase() === 'http') ? '' : 's';
        const response = await this.axiosInstance.get(`http${s}://api.ipify.org?format=text`);
        const proxyIP = response.data;
        logger.info(`🔍 Проверка прокси для ${this.phpMyAdminUrl.split(':')[0]}: Используется IP ${proxyIP}`);
        return response;
    } catch (error) {
        logger.warn(`⚠️ Не удалось проверить IP через прокси: ${error.message}`);
    }
}

////////////////////////////////////////////////////////////// временно, удалить проверка, что запрос идё через прокси
if (await this.checkProxy().then(res=>res.data.startsWith(this.proxy.split(':')[0]))) {
    logger.info(`✅ Прокси активно (${this.proxy})`);
} else {
    logger.warn(`⚠️ Прокси не работает, возможен прямой запрос!`);
}
*/
