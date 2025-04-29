import { getVgInstance } from './index.js';
const vg = getVgInstance();

function clientsReady() {
    const clients = [...vg.coordinator().clients];
    return Promise.allSettled(clients.map(c => c.pending))
}

async function activateInteractorsAndInputs(interactors, inputs) {
    for (const interactor of interactors) {
      performance.mark('activation-start');
      interactor.activate();
      await waitForQueryToFinish();
      performance.mark('activation-end');
      performance.measure(`interactor-activation-${interactor.constructor.name}`, 'activation-start', 'activation-end');
    }

    for (const input of inputs) {
      performance.mark('activation-start');
      input.activate();
      await waitForQueryToFinish();
      performance.mark('activation-end');
      performance.measure(`input-activation-${input.constructor.name}`, 'activation-start', 'activation-end');
    }
  }

async function waitForQueryToFinish() {
    while (vg.coordinator().manager.pendingExec) {
        await new Promise(resolve => setTimeout(resolve, 0));
    }
}


function processClients() {
    const interactors = new Set();
    const inputs = new Set();
    if (!vg.coordinator().clients) return { interactors, inputs };

    for (const client of vg.coordinator().clients) {
        if (client instanceof vg.MosaicClient && client.activate) {
            inputs.add(client);
        }
        if (client.plot) {
            for (const interactor of client.plot.interactors) {
                interactors.add(interactor);
            }
        }
    }
    return { interactors, inputs };
}

clientsReady()
    .then(async () => {
        const { interactors, inputs } = processClients();
        // performance.mark('hydration-start');
        await new Promise(resolve => setTimeout(resolve, 0));
        await waitForQueryToFinish();
        performance.mark('activate-start');
        await activateInteractorsAndInputs(interactors, inputs)
        performance.mark('activate-end');
        performance.measure('activate', 'activate-start', 'activate-end');
    })