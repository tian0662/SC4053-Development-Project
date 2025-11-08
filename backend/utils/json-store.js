const fs = require('fs');
const path = require('path');

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

class JsonStore {
  constructor(filename, { defaultValue = [] } = {}) {
    if (!filename) {
      throw new Error('JsonStore filename is required');
    }
    this.filePath = path.join(process.cwd(), 'backend', 'data', filename);
    this.defaultValue = defaultValue;
    this._ensureDirectory();
    this.data = this._readFile();
  }

  _ensureDirectory() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  _readFile() {
    if (!fs.existsSync(this.filePath)) {
      return deepClone(this.defaultValue);
    }
    try {
      const contents = fs.readFileSync(this.filePath, 'utf8');
      if (!contents.trim()) {
        return deepClone(this.defaultValue);
      }
      return JSON.parse(contents);
    } catch (error) {
      return deepClone(this.defaultValue);
    }
  }

  _writeFile(data) {
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  getAll() {
    return deepClone(this.data);
  }

  setAll(data) {
    this.data = deepClone(data);
    this._writeFile(this.data);
  }
}

module.exports = JsonStore;
