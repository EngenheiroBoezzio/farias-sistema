/* A única ponte entre a tela e o sistema.
   Lista fechada de funções: a página não enxerga Node, nem fs, nem ipcRenderer
   solto. Se um dia a tela for comprometida, o estrago para aqui. */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('farias', {
  lerConfig: () => ipcRenderer.invoke('config:ler'),
  salvarConfig: c => ipcRenderer.invoke('config:salvar', c),
  versao: () => ipcRenderer.invoke('app:versao'),
  origem: () => ipcRenderer.invoke('app:origem'),
  verificarAtualizacao: () => ipcRenderer.invoke('app:verificar-atualizacao'),
  aoTerAtualizacao: cb => {
    const h = (_e, v) => cb(v);
    ipcRenderer.on('app:atualizacao-pronta', h);
    return () => ipcRenderer.off('app:atualizacao-pronta', h);
  }
});
