require('dotenv').config();

module.exports = {
    phpMyAdmin: process.env.PHP_MY_ADMIN_URL || "http://localhost/phpmyadmin",
    dbUser: process.env.DB_USER || "root",
    dbPass: process.env.DB_PASS || "",
    threads: parseInt(process.env.THREADS || "5", 10),
};
