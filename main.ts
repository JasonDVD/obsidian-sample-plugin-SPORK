import { createServer, IncomingMessage, ServerResponse, Server } from 'http';
import { App, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';

interface VoicePluginSettings {
    serverPort: number;
}

const DEFAULT_SETTINGS: VoicePluginSettings = {
    serverPort: 27123,
};

export default class HAVoicePlugin extends Plugin {
    settings: VoicePluginSettings;
    server: Server | null = null;

    async onload() {
        await this.loadSettings();
        await this.startServer();
        this.addSettingTab(new HAVoiceSettingTab(this.app, this));
    }

    onunload() {
        if (this.server) {
            this.server.close();
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async startServer() {
        this.server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
            if (req.method === 'POST' && req.url === '/command') {
                const chunks: Buffer[] = [];
                for await (const chunk of req) chunks.push(chunk as Buffer);
                try {
                    const body = JSON.parse(Buffer.concat(chunks).toString());
                    const text = body?.text || '';
                    const result = await this.handleCommand(text);
                    res.setHeader('Content-Type', 'application/json');
                    res.write(JSON.stringify({ result }));
                } catch (e) {
                    res.statusCode = 400;
                    res.write(JSON.stringify({ error: 'bad request' }));
                }
                res.end();
                return;
            }
            res.statusCode = 404;
            res.end();
        }).listen(this.settings.serverPort, () => {
            console.log(`HA Voice Plugin server listening on ${this.settings.serverPort}`);
        });
    }

    async handleCommand(text: string): Promise<string> {
        const lower = text.toLowerCase().trim();
        if (lower.startsWith('create note ')) {
            const title = text.substring('create note '.length).trim();
            await this.createNote(title);
            return `created note ${title}`;
        }
        if (lower.startsWith('append to ')) {
            const match = text.match(/^append to (.+?):\s*(.+)$/i);
            if (match) {
                const file = match[1];
                const content = match[2];
                await this.appendTo(file, content);
                return `appended to ${file}`;
            }
        }
        if (lower.startsWith('read note ')) {
            const title = text.substring('read note '.length).trim();
            const content = await this.readNote(title);
            return content ?? 'note not found';
        }
        if (lower === 'list notes') {
            const files = this.app.vault.getMarkdownFiles().map(f => f.basename);
            return files.join(', ');
        }
        if (lower.startsWith('search for ')) {
            const term = text.substring('search for '.length).trim();
            const matches = await this.searchNotes(term);
            return matches.join(', ');
        }
        return 'unknown command';
    }

    async getFileByName(name: string): Promise<TFile | null> {
        const file = this.app.vault.getMarkdownFiles().find(f => f.basename === name);
        return file ?? null;
    }

    async createNote(name: string) {
        const existing = await this.getFileByName(name);
        if (existing) return;
        await this.app.vault.create(`${name}.md`, '');
    }

    async appendTo(name: string, text: string) {
        const file = await this.getFileByName(name);
        if (!file) return;
        await this.app.vault.append(file, `\n${text}`);
    }

    async readNote(name: string): Promise<string | null> {
        const file = await this.getFileByName(name);
        if (!file) return null;
        return await this.app.vault.read(file);
    }

    async searchNotes(term: string): Promise<string[]> {
        const files = this.app.vault.getMarkdownFiles();
        const results: string[] = [];
        for (const file of files) {
            const content = await this.app.vault.read(file);
            if (content.toLowerCase().includes(term.toLowerCase())) {
                results.push(file.basename);
            }
        }
        return results;
    }
}

class HAVoiceSettingTab extends PluginSettingTab {
    plugin: HAVoicePlugin;

    constructor(app: App, plugin: HAVoicePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName('Server Port')
            .setDesc('Port for the HTTP server')
            .addText(text => text
                .setPlaceholder('27123')
                .setValue(String(this.plugin.settings.serverPort))
                .onChange(async (value) => {
                    const num = parseInt(value, 10);
                    if (!Number.isNaN(num)) {
                        this.plugin.settings.serverPort = num;
                        await this.plugin.saveSettings();
                    }
                }));
    }
}
