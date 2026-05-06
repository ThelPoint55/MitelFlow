'use strict';

const AUTH_CONFIG = {
  clientId:    '88bc4df4-c460-4730-930f-2aff0303d21d',
  tenantId:    '4bff5a2b-b30d-4939-81ff-8f76138347df',
  scopes:      ['User.Read'],
  redirectUri: location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'http://localhost:3000'
    : 'https://thelpoint55.github.io/MitelFlow',
};
