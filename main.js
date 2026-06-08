const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');

// ── CHROMIUM PERMISSION WORKAROUNDS ──
// Forces Electron to run its cache in RAM to prevent OneDrive/Windows folder lock crashes
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-http-cache');

let mainWindow;
let botProcess = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 800,
        frame: false,
        backgroundColor: '#09090d',
        icon: path.join(__dirname, 'icon.ico'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

// ── SMART DIAGNOSTIC PARSER ENGINE ──
function parseErrorMessage(errorLog) {
    let diagnosis = "An unhandled script exception occurred.";
    let fix = "Review your code syntax and ensure your background dependencies are fully updated.";

    // 1. Check for Discord Token Errors
    if (errorLog.includes('TokenInvalid') || errorLog.includes('DisallowedIntents') || errorLog.includes('PRIVILEGED_INTENTS')) {
        diagnosis = "Discord Authentication Failed (Invalid or Missing Token / Intents).";
        fix = "Make sure you pasted a valid Bot Token into the input field above. If using Gateway Intents, make sure they are turned ON in the Discord Developer Portal under the 'Bot' tab.";
    }
    // 2. Check for missing module/library requirements
    else if (errorLog.includes('Cannot find module') || errorLog.includes('ModuleNotFoundError')) {
        const match = errorLog.match(/(?:Cannot find module\s+'|No module named\s+')([^"'\s]+)/);
        const moduleName = match ? match[1] : "required package";
        diagnosis = `Missing Dependency Workspace Module: "${moduleName}"`;
        fix = `The app tried auto-installing it, but permissions blocked it. Run 'npm install ${moduleName}' or 'pip install ${moduleName}' manually in your main project folder terminal.`;
    }
    // 3. JavaScript Syntax Errors
    else if (errorLog.includes('SyntaxError')) {
        diagnosis = "Code Structure / Syntax Error detected.";
        fix = "Look closely at the error code line. You are likely missing a closing bracket '}', a parenthesis ')', or a comma somewhere in your bot template.";
    }
    // 4. Python indentation crashes
    else if (errorLog.includes('IndentationError')) {
        diagnosis = "Python Structural Alignment Error (Indentation Failure).";
        fix = "Python relies strictly on blank spaces. Make sure your function blocks use consistent spacing (either 4 spaces or 1 tab everywhere).";
    }

    return `\n==================================================\n[🚨 SYSTEM CRASH DIAGNOSIS]\n-> WHAT HAPPENED: ${diagnosis}\n-> HOW TO FIX IT: ${fix}\n==================================================\n`;
}

// ── WINDOW CONTROLS INTERCEPTORS ──
ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
});
ipcMain.on('window-close', () => mainWindow.close());

// ── CORE BOT EXECUTION ARCHITECTURE ──
ipcMain.on('start-bot', (event, { code, token, language }) => {
    let tempFilePath;
    let cmd = '';
    let args = [];

    if (botProcess) botProcess.kill();

    mainWindow.webContents.send('console-log', `[*] Scanning ${language === 'javascript' ? 'Node.js' : 'Python'} code architecture...`);

    let optimizedCode = code;

    // JavaScript Core Building Sequence
    if (language === 'javascript') {
        tempFilePath = path.join(__dirname, 'temp_bot.js');
        optimizedCode = `process.env.TOKEN = "${token}";\nprocess.env.DISCORD_TOKEN = "${token}";\n${code}`;
        fs.writeFileSync(tempFilePath, optimizedCode, 'utf-8');

        // Extract and install dynamic dependencies
        const requireRegex = /(?:require\s*\(\s*['"])([^'\".][^'\"]*)(?:['\"]\s*\))|(?:from\s*['\"])([^'\".][^'\"]*)(?:[''])/g;
        let dependencies = [];
        let match;
        while ((match = requireRegex.exec(code)) !== null) {
            const pkg = match[1] || match[2];
            if (pkg && !dependencies.includes(pkg)) dependencies.push(pkg);
        }
        if (!dependencies.includes('discord.js') && code.includes('Client')) dependencies.push('discord.js');

        for (const dep of dependencies) {
            const nodeModulesPath = path.join(__dirname, 'node_modules', dep);
            if (!fs.existsSync(nodeModulesPath)) {
                try {
                    execSync(`npm install ${dep}`, { cwd: __dirname });
                } catch (err) {}
            }
        }
        cmd = 'node';
        args = [tempFilePath];
    } 
    // Python Core Building Sequence
    else {
        tempFilePath = path.join(__dirname, 'temp_bot.py');
        optimizedCode = `import os\nos.environ['TOKEN'] = "${token}"\nos.environ['DISCORD_TOKEN'] = "${token}"\n${code}`;
        fs.writeFileSync(tempFilePath, optimizedCode, 'utf-8');

        const importRegex = /^\s*(?:import|from)\s+([a-zA-Z0-9_]+)/mg;
        let pyDeps = [];
        let match;
        while ((match = importRegex.exec(code)) !== null) {
            if (match[1] && !pyDeps.includes(match[1])) pyDeps.push(match[1]);
        }
        if (!pyDeps.includes('discord') && code.includes('discord.')) pyDeps.push('discord');

        for (let dep of pyDeps) {
            try {
                execSync(`python -m pip install ${dep === 'discord' ? 'discord.py' : dep}`);
            } catch (err) {}
        }
        cmd = 'python';
        args = ['-u', tempFilePath];
    }

    mainWindow.webContents.send('console-log', '[*] Running background initialization sequence...');
    
    botProcess = spawn(cmd, args, {
        env: { ...process.env, TOKEN: token, DISCORD_TOKEN: token },
        shell: true
    });

    let accumulatedErrorLog = "";

    botProcess.stdout.on('data', (data) => {
        mainWindow.webContents.send('console-log', data.toString().trim());
    });

    botProcess.stderr.on('data', (data) => {
        const errorString = data.toString();
        accumulatedErrorLog += errorString;
        mainWindow.webContents.send('console-log', `[ERROR] ${errorString.trim()}`);
    });

    botProcess.on('close', () => {
        if (accumulatedErrorLog.trim().length > 0) {
            const clearExplanation = parseErrorMessage(accumulatedErrorLog);
            mainWindow.webContents.send('console-log', clearExplanation);
        }
        mainWindow.webContents.send('console-log', '[*] Bot process stopped safely.');
        accumulatedErrorLog = "";
    });
});

ipcMain.on('stop-bot', () => {
    if (botProcess) {
        botProcess.kill();
        mainWindow.webContents.send('console-log', '[*] Bot execution killed manually.');
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});