import { readResponse } from '../server/read-api.mjs';

export default {
  fetch(request) {
    return readResponse('config', request.method);
  }
};
