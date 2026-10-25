// Remove pontos, traços e espaços: "529.982.247-25" -> "52998224725"
export const normalizarCpf = (cpf: string): string => cpf.replace(/\D/g, '');

// Calcula um dígito verificador a partir dos dígitos anteriores.
// Pesos começam em (quantidade de dígitos + 1) e descem até 2.
const calcularDigito = (digitos: string): number => {
  const pesoInicial = digitos.length + 1;
  const soma = [...digitos].reduce(
    (acc, digito, i) => acc + Number(digito) * (pesoInicial - i),
    0,
  );
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
};

export const cpfValido = (cpf: string): boolean => {
  const numeros = normalizarCpf(cpf);
  if (numeros.length !== 11) return false;
  // 000.000.000-00, 111.111.111-11 etc. passam na conta, mas não são CPFs reais
  if (/^(\d)\1{10}$/.test(numeros)) return false;

  const primeiro = calcularDigito(numeros.slice(0, 9));
  const segundo = calcularDigito(numeros.slice(0, 10));
  return primeiro === Number(numeros[9]) && segundo === Number(numeros[10]);
};
