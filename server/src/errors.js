export class AppError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function invariant(condition, code, message, status = 400, details = undefined) {
  if (!condition) throw new AppError(code, message, status, details);
}

export function serializeError(error) {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) };
  }
  if (error?.name === 'ZodError') {
    return { code: 'VALIDATION_ERROR', message: 'Dados inválidos', details: error.flatten() };
  }
  return { code: 'INTERNAL_ERROR', message: 'Não foi possível concluir a operação' };
}
