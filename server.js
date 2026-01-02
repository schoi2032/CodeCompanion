const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = 3000;
const DB_FILE = path.join(__dirname, 'db.json');

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '/')));

// --- Persistence Helpers ---
function loadDb() {
    if (!fs.existsSync(DB_FILE)) {
        return { conversations: [] };
    }
    try {
        return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
        return { conversations: [] };
    }
}

function saveDb(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// --- API Endpoints ---

// 1. Get all conversations (summary only)
app.get('/api/conversations', (req, res) => {
    const db = loadDb();
    const summaries = db.conversations.map(c => ({
        id: c.id,
        title: c.title,
        updatedAt: c.updatedAt
    })).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    res.json(summaries);
});

// 2. Get single conversation
app.get('/api/conversations/:id', (req, res) => {
    const db = loadDb();
    const conversation = db.conversations.find(c => c.id === req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Not found' });
    res.json(conversation);
});

// 3. Create new conversation
app.post('/api/conversations', (req, res) => {
    const db = loadDb();
    const newConv = {
        id: Date.now().toString(),
        title: 'New Chat',
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    db.conversations.push(newConv);
    saveDb(db);
    res.json(newConv);
});

// 4. Update Conversation (Rename)
app.put('/api/conversations/:id', (req, res) => {
    const db = loadDb();
    const conv = db.conversations.find(c => c.id === req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });

    if (req.body.title) {
        conv.title = req.body.title;
        conv.updatedAt = new Date().toISOString();
        saveDb(db);
    }
    res.json(conv);
});

// 5. Delete Conversation
app.delete('/api/conversations/:id', (req, res) => {
    const db = loadDb();
    const initialLength = db.conversations.length;
    db.conversations = db.conversations.filter(c => c.id !== req.params.id);

    if (db.conversations.length === initialLength) {
        return res.status(404).json({ error: 'Not found' });
    }

    saveDb(db);
    res.json({ success: true });
});

// 6. Save message to conversation (and Proxy to Anthropic)
app.post('/api/conversations/:id/message', async (req, res) => {
    const { message } = req.body;
    const conversationId = req.params.id;

    if (!message) return res.status(400).json({ error: 'Message required' });

    // 1. Load Conversation
    const db = loadDb();
    const conv = db.conversations.find(c => c.id === conversationId);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    // 2. Append User Message
    const userMsg = { role: 'user', content: message };
    conv.messages.push(userMsg);

    // Auto-generate title if it's the first message and title is "New Chat"
    if (conv.messages.length === 1 && conv.title === 'New Chat') {
        conv.title = message.slice(0, 30) + (message.length > 30 ? '...' : '');
    }

    try {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) throw new Error('Missing API Key');

        // 3. call Anthropic
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-3-5-sonnet-20240620',
                max_tokens: 1000,
                messages: conv.messages, // Send full history
                system: 'You are an expert coding assistant. Help users with coding questions, debugging, explanations, and best practices. Provide clear, concise code examples when appropriate. Get straight to answering their questions without introducing yourself. Be direct and helpful.'
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error?.message || 'API Error');
        }

        const assistantText = data.content[0].text;

        // 4. Append Assistant Message
        conv.messages.push({ role: 'assistant', content: assistantText });
        conv.updatedAt = new Date().toISOString();
        saveDb(db);

        res.json({
            role: 'assistant',
            content: assistantText,
            conversationId: conv.id,
            title: conv.title
        });

    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Serve index.html for root requests
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});