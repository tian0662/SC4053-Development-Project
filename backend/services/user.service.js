const { ethers } = require('ethers');
const JsonStore = require('../utils/json-store');

function normalizeAddress(address) {
  if (!address) {
    return '';
  }
  try {
    return ethers.getAddress(address);
  } catch (error) {
    return address.toLowerCase();
  }
}

class UserService {
  constructor() {
    this.store = new JsonStore('users.json', { defaultValue: [] });
    this.users = new Map();
    this._load();
  }

  _load() {
    const records = this.store.getAll();
    if (!Array.isArray(records)) {
      return;
    }
    records.forEach((user) => {
      if (user?.address) {
        this.users.set(normalizeAddress(user.address), user);
      }
    });
  }

  _persist() {
    this.store.setAll(Array.from(this.users.values()));
  }

  listUsers() {
    return Array.from(this.users.values()).map((user) => ({ ...user }));
  }

  getUser(address) {
    if (!address) {
      return null;
    }
    return this.users.get(normalizeAddress(address)) || null;
  }

  registerUser(input = {}) {
    const { address, displayName = '', publicKey = '', metadata = {} } = input;
    if (!address) {
      throw new Error('User address is required');
    }

    const normalized = normalizeAddress(address);
    const existing = this.users.get(normalized) || {};
    const user = {
      ...existing,
      address: normalized,
      displayName: displayName || existing.displayName || '',
      publicKey: publicKey || existing.publicKey || '',
      metadata: { ...(existing.metadata || {}), ...(metadata || {}) },
      lastSeenAt: new Date().toISOString(),
    };

    if (!existing.createdAt) {
      user.createdAt = new Date().toISOString();
    } else {
      user.createdAt = existing.createdAt;
    }

    this.users.set(normalized, user);
    this._persist();
    return user;
  }
}

module.exports = new UserService();
