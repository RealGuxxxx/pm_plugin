function decodeBpeUnicode(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    let b = c;
    if (c >= 256) {
      if (c >= 256 && c <= 288) {
        b = c - 256;
      } else if (c >= 289 && c <= 322) {
        b = c - 289 + 127;
      } else if (c === 323) {
        b = 173;
      }
    }
    bytes.push(b);
  }
  return Buffer.from(bytes).toString('utf8');
}

const garbledText = "ĊĊ###ĠåĪĨæŀĲç»ĵæŀľ";
const decodedText = decodeBpeUnicode(garbledText);
console.log('Original garbled:', garbledText);
console.log('Decoded text:', JSON.stringify(decodedText));
console.log('Decoded print:\n', decodedText);
