const express = require('express');
const { addTask } = require('./checker');

const app = express();
app.use(express.json());

app.post('/add-task', (req, res) => {
    const { query } = req.body;
    if (!query) {
        return res.status(400).send('Query is required');
    }

    addTask(query);
    res.status(200).send('Task added');
});

app.listen(3000, () => console.log('Server running on port 3000'));
