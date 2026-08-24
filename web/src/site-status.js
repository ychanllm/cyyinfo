import { api } from './api';

let statusPromise = null;

export function loadSiteStatus() {
  if (!statusPromise) {
    statusPromise = api('/site/status').catch((error) => {
      statusPromise = null;
      throw error;
    });
  }
  return statusPromise;
}
