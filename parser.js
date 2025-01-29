const cheerio = require('cheerio');

// Распарсить HTML-таблицы из поля MESSAGE
const parseHTMLMessage = (html) => {
    if (typeof (html) !== 'string') return html;
    const $ = cheerio.load(html);
    const rows = [];

    $('table tr').each((_, row) => {
        const columns = [];
        $(row).find('td').each((_, cell) => {
            columns.push($(cell).text());
        });
        rows.push(columns);
    });

    return rows;
};

module.exports = { parseHTMLMessage };
