/** Uma resposta que não chega no prazo vira erro; a que chegar depois é ignorada. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    void promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
