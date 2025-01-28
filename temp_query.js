const executeSQLQuery = async (query) => {
    const sqlUrl = `${phpMyAdminUrl}/sql.php`;

    try {
        const response = await axios.post(
            sqlUrl,
            new URLSearchParams({ sql: query }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                jar: cookieJar, // Передаем сохраненные куки
                withCredentials: true,
            }
        );

        // Здесь хранится HTML или JSON, в зависимости от версии PHPMyAdmin.
        return response.data;
    } catch (error) {
        console.error('Query error:', error.message);
        return null;
    }
};

// Пример выполнения запроса:
(async () => {
    const databases = await executeSQLQuery('SHOW DATABASES;');
    console.log('Databases:', databases);
})();
