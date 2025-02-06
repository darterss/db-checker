const http = require('http');
const httpProxy = require('http-proxy');

const proxy = httpProxy.createProxyServer({});

const server = http.createServer((req, res) => {
    console.log(`Проксируем запрос на ${req.url}`);
    proxy.web(req, res, { target: req.url});
});
server.listen(8079, () => {
    console.log('Локальный прокси-сервер запущен на http://localhost:8079');
});

/*
const http = require('http');
const httpProxy = require('http-proxy');

const target = 'http://185.238.73.127';

const proxy = httpProxy.createProxyServer({});

const server = http.createServer((req, res) => {
    console.log(`Проксируем: ${target}`);
    proxy.web(req, res, { target, changeOrigin: true });
});

server.listen(8078, () => {
    console.log('Прокси работает: http://localhost:8079');
});
*/
