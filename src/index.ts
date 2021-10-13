import {
  commands,
  ExtensionContext,
  LanguageClient,
  LanguageClientOptions,
  Location,
  Position,
  Range,
  ServerOptions,
  Uri,
  window,
  workspace,
  WorkspaceFolder,
} from 'coc.nvim';

import net from 'net';
import child_process from 'child_process';
import { existsSync } from 'fs';

interface Invoking {
  kind: 'invoking';
  workspaceFolder: WorkspaceFolder;
  process: child_process.ChildProcessWithoutNullStreams;
}

interface Running {
  kind: 'running';
  workspaceFolder: WorkspaceFolder;
  client: LanguageClient;
}

type State = Invoking | Running;

const CONFIGURATION_ROOT_SECTION = 'typeprof';

// MEMO: VSCode only features
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function addToggleButton(context: ExtensionContext) {
  const statusBarItem = window.createStatusBarItem(0);
  statusBarItem.text = 'TypeProf $(eye)';
  statusBarItem.show();

  // MEMO: This is probably an internal command, so I set internal to true
  const disposable = commands.registerCommand(
    'typeprof.toggle',
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (arg0: any, arg1: any, arg2: any, arg3: any) => {
      if (statusBarItem.text == 'TypeProf $(eye)') {
        statusBarItem.text = 'TypeProf $(eye-closed)';
        commands.executeCommand('typeprof.disableSignature');
      } else {
        statusBarItem.text = 'TypeProf $(eye)';
        commands.executeCommand('typeprof.enableSignature');
      }
    },
    null,
    true
  );

  context.subscriptions.push(disposable);
}

function addJumpToRBS(context: ExtensionContext) {
  // MEMO: This is probably an internal command, so I set internal to true
  // ----
  // MEMO: It may be executed from codeaction or codelens in the future.
  const disposable = commands.registerCommand(
    'typeprof.jumpToRBS',
    (arg0: any, arg1: any, arg2: any, arg3: any) => {
      const uri0 = Uri.parse(arg0);
      const pos0 = Position.create(arg1.line, arg1.character);
      const uri1 = Uri.parse(arg2);
      const pos1 = Position.create(arg3.start.line, arg3.start.character);
      const pos2 = Position.create(arg3.end.line, arg3.end.character);
      const range = Range.create(pos1, pos2);
      // MEMO: In the case of coc.nvim, maybe uri1.fsPath?
      const loc = Location.create(uri1.fsPath, range);
      commands.executeCommand('editor.action.peekLocations', uri0, pos0, [loc], 'peek');
    },
    null,
    true
  );

  context.subscriptions.push(disposable);
}

function executeTypeProf(folder: WorkspaceFolder, arg: string): child_process.ChildProcessWithoutNullStreams {
  const configuration = workspace.getConfiguration(CONFIGURATION_ROOT_SECTION);
  const customServerPath = configuration.get<string | null>('server.path');
  const cwd = Uri.parse(folder.uri).fsPath;

  let cmd: string;
  if (existsSync(`${cwd}/bin/typeprof`)) {
    cmd = './bin/typeprof';
  } else if (customServerPath) {
    cmd = customServerPath;
  } else if (existsSync(`${cwd}/Gemfile`)) {
    cmd = 'bundle exec typeprof';
  } else {
    cmd = 'typeprof';
  }
  cmd = cmd + ' ' + arg;

  const shell = process.env.SHELL;
  let typeprof: child_process.ChildProcessWithoutNullStreams;
  if (shell && (shell.endsWith('bash') || shell.endsWith('zsh') || shell.endsWith('fish'))) {
    typeprof = child_process.spawn(shell, ['-c', '-l', cmd], { cwd });
  } else {
    typeprof = child_process.spawn(cmd, { cwd });
  }

  return typeprof;
}

function getTypeProfVersion(
  folder: WorkspaceFolder,
  callback: (version: string) => void
): child_process.ChildProcessWithoutNullStreams {
  const typeprof = executeTypeProf(folder, '--version');
  let output = '';

  typeprof.stdout?.on('data', (out) => {
    output += out;
  });
  typeprof.stderr?.on('data', (out) => {
    console.log(out);
  });
  typeprof.on('error', (e) => {
    console.info(`typeprof is not supported for this folder: ${folder}`);
    console.info(`because: ${e}`);
  });
  typeprof.on('exit', (code) => {
    if (code == 0) {
      console.info(`typeprof version: ${output}`);
      const str = output.trim();
      const version = /^typeprof (\d+).(\d+).(\d+)$/.exec(str);
      if (version) {
        const major = Number(version[1]);
        const minor = Number(version[2]);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const _teeny = Number(version[3]);
        if (major >= 1 || (major == 0 && minor >= 20)) {
          callback(str);
        } else {
          console.info(`typeprof version ${str} is too old; please use 0.20.0 or later for IDE feature`);
        }
      } else {
        console.info(`typeprof --version showed unknown message`);
      }
    } else {
      console.info(`failed to invoke typeprof: error code ${code}`);
    }
    typeprof.kill();
  });
  return typeprof;
}

function getTypeProfStream(
  folder: WorkspaceFolder,
  error: (msg: string) => void
): Promise<{ host: string; port: number; pid: number; stop: () => void }> {
  return new Promise((resolve, reject) => {
    const typeprof = executeTypeProf(folder, '--lsp');

    let buffer = '';
    typeprof.stdout.on('data', (data) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      buffer += data;
      try {
        const json = JSON.parse(data);
        json['stop'] = () => typeprof.kill('SIGINT');
        resolve(json);
      } catch (err) {}
    });

    let err = '';
    typeprof.stderr.on('data', (data) => {
      err += data;
      while (true) {
        const i = err.indexOf('\n');
        if (i < 0) break;
        error(err.slice(0, i));
        err = err.slice(i + 1);
      }
    });

    typeprof.on('exit', (code) => reject(`error code ${code}`));
  });
}

function invokeTypeProf(folder: WorkspaceFolder): LanguageClient {
  const reportError = (msg: string) => client.info(msg);

  const serverOptions: ServerOptions = async () => {
    const { host, port, stop } = await getTypeProfStream(folder, reportError);
    const socket: net.Socket = net.createConnection(port, host);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    socket.on('close', (_had_error) => stop());

    return {
      reader: socket,
      writer: socket,
    };
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'ruby' },
      { scheme: 'file', language: 'rbs' },
    ],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher('{**/*.rb,**/*.rbs}'),
    },
  };

  const client = new LanguageClient('Ruby TypeProf', serverOptions, clientOptions);

  return client;
}

const clientSessions: Map<WorkspaceFolder, State> = new Map();

function startTypeProf(folder: WorkspaceFolder) {
  const statusBar = window.createStatusBarItem(0);
  const showStatus = (msg: string) => {
    statusBar.text = msg;
    statusBar.show();
    setTimeout(() => {
      statusBar.hide();
    }, 3000);
  };

  console.log(`start: ${folder.uri}`);

  const typeprof = getTypeProfVersion(folder, (version) => {
    if (!version) {
      showStatus(`Ruby TypeProf is not configured; Try to add "gem 'typeprof'" to Gemfile`);
      clientSessions.delete(folder);
      return;
    }
    showStatus(`Starting Ruby TypeProf (${version})...`);
    const client = invokeTypeProf(folder);
    client
      .onReady()
      .then(() => {
        showStatus('Ruby TypeProf is running');
      })
      .catch((e: any) => {
        showStatus(`Failed to start Ruby TypeProf: ${e}`);
      });
    client.start();
    clientSessions.set(folder, { kind: 'running', workspaceFolder: folder, client });
  });

  clientSessions.set(folder, { kind: 'invoking', workspaceFolder: folder, process: typeprof });
}

function stopTypeProf(state: State) {
  console.log(`stop: ${state.workspaceFolder}`);
  switch (state.kind) {
    case 'invoking':
      state.process.kill();

      break;
    case 'running':
      state.client.stop();
      break;
  }
  clientSessions.delete(state.workspaceFolder);
}

function restartTypeProf() {
  workspace.workspaceFolders?.forEach((folder) => {
    const state = clientSessions.get(folder);
    if (state) stopTypeProf(state);
    startTypeProf(folder);
  });
}

function ensureTypeProf() {
  if (!workspace.workspaceFolders) return;

  const activeFolders = new Set(workspace.workspaceFolders);

  clientSessions.forEach((state) => {
    if (!activeFolders.has(state.workspaceFolder)) {
      stopTypeProf(state);
    }
  });

  activeFolders.forEach((folder) => {
    if (Uri.parse(folder.uri).scheme === 'file' && !clientSessions.has(folder)) {
      startTypeProf(folder);
    }
  });
}

function addRestartCommand(context: ExtensionContext) {
  const disposable = commands.registerCommand('typeprof.restart', () => {
    restartTypeProf();
  });
  context.subscriptions.push(disposable);
}

export function deactivate() {
  clientSessions.forEach((state) => {
    stopTypeProf(state);
  });
}

export async function activate(context: ExtensionContext): Promise<void> {
  const extensionConfig = workspace.getConfiguration('typeprof');
  const isEnable = extensionConfig.get<boolean>('enable', true);
  if (!isEnable) return;

  // MEMO: VSCode only (Custom button feature in Status Bar)
  //addToggleButton(context);
  addJumpToRBS(context);
  addRestartCommand(context);
  ensureTypeProf();
}
