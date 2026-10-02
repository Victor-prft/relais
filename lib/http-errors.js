'use strict';

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (message, details) => new HttpError(400, 'bad_request', message, details);
const unauthorized = (message = 'Authentification requise') => new HttpError(401, 'unauthorized', message);
const forbidden = (message = 'Accès refusé') => new HttpError(403, 'forbidden', message);
const notFound = (message = 'Introuvable') => new HttpError(404, 'not_found', message);
const conflict = (message, details) => new HttpError(409, 'conflict', message, details);
const unprocessable = (message, details) => new HttpError(422, 'invalid_state', message, details);

module.exports = { HttpError, badRequest, unauthorized, forbidden, notFound, conflict, unprocessable };
