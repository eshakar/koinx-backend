import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/koinx';

let useMongo = false;

// Custom JSON File Collection for zero-dependency local fallback
export class JsonCollection {
  constructor(name) {
    this.name = name;
    this.filePath = path.join(process.cwd(), '.data', `${name}.json`);
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify([]));
    }
  }

  async read() {
    try {
      const data = await fs.promises.readFile(this.filePath, 'utf8');
      return JSON.parse(data);
    } catch (e) {
      return [];
    }
  }

  async write(data) {
    await fs.promises.writeFile(this.filePath, JSON.stringify(data, null, 2));
  }

  async find(query = {}) {
    const list = await this.read();
    return list.filter(item => {
      for (const key in query) {
        if (query[key] !== undefined && item[key] !== query[key]) {
          return false;
        }
      }
      return true;
    });
  }

  async findOne(query = {}) {
    const list = await this.read();
    return list.find(item => {
      for (const key in query) {
        if (query[key] !== undefined && item[key] !== query[key]) {
          return false;
        }
      }
      return true;
    }) || null;
  }

  async create(doc) {
    const list = await this.read();
    const newDoc = { 
      _id: Math.random().toString(36).substring(2, 11), 
      ...doc, 
      createdAt: new Date().toISOString() 
    };
    list.push(newDoc);
    await this.write(list);
    return newDoc;
  }

  async insertMany(docs) {
    const list = await this.read();
    const createdDocs = docs.map(doc => ({
      _id: Math.random().toString(36).substring(2, 11),
      ...doc,
      createdAt: new Date().toISOString()
    }));
    list.push(...createdDocs);
    await this.write(list);
    return createdDocs;
  }

  async updateOne(query, update) {
    const list = await this.read();
    const index = list.findIndex(item => {
      for (const key in query) {
        if (query[key] !== undefined && item[key] !== query[key]) {
          return false;
        }
      }
      return true;
    });
    if (index === -1) return { nModified: 0 };
    
    const item = list[index];
    if (update.$set) {
      list[index] = { ...item, ...update.$set };
    } else {
      list[index] = { ...item, ...update };
    }
    await this.write(list);
    return { nModified: 1 };
  }

  async deleteMany(query = {}) {
    const list = await this.read();
    const filtered = list.filter(item => {
      for (const key in query) {
        if (query[key] !== undefined && item[key] === query[key]) {
          return false;
        }
      }
      return true;
    });
    await this.write(filtered);
    return { deletedCount: list.length - filtered.length };
  }

  async countDocuments(query = {}) {
    const list = await this.find(query);
    return list.length;
  }
}

// DNS resolver helper for systems that block querySrv (e.g. Node DNS resolution issues on Windows)
async function resolveSrvConnectionString(uri) {
  if (!uri || !uri.startsWith('mongodb+srv://')) {
    return uri;
  }

  try {
    const dns = await import('dns');
    const match = uri.match(/^mongodb\+srv:\/\/([^:]+):([^@]+)@([^/?#]+)([^?#]*)\??(.*)$/);
    if (!match) return uri;

    const username = match[1];
    const password = match[2];
    const host = match[3];
    const pathName = match[4];
    const queryStr = match[5];

    let srvRecords;
    let txtRecords;
    
    try {
      srvRecords = await dns.promises.resolveSrv(`_mongodb._tcp.${host}`);
      txtRecords = await dns.promises.resolveTxt(host);
    } catch (e) {
      console.warn(`[DNS RESOLVER] Default DNS SRV resolution failed: ${e.message}. Trying public DNS fallback...`);
      const ResolverClass = dns.promises.Resolver;
      if (ResolverClass) {
        const resolver = new ResolverClass();
        resolver.setServers(['8.8.8.8', '1.1.1.1']);
        srvRecords = await resolver.resolveSrv(`_mongodb._tcp.${host}`);
        txtRecords = await resolver.resolveTxt(host);
      } else {
        throw e;
      }
    }

    if (!srvRecords || srvRecords.length === 0) {
      throw new Error('No SRV records found');
    }

    const hostList = srvRecords.map(r => `${r.name}:${r.port}`).join(',');
    
    let txtOptions = '';
    if (txtRecords && txtRecords.length > 0) {
      txtOptions = txtRecords.flat().join('&');
    }

    const options = [];
    options.push('ssl=true');
    if (txtOptions) options.push(txtOptions);
    if (queryStr) options.push(queryStr);

    const mergedQuery = options.filter(Boolean).join('&');
    const standardUri = `mongodb://${username}:${password}@${hostList}${pathName || ''}?${mergedQuery}`;
    return standardUri;
  } catch (err) {
    console.warn(`[DNS RESOLVER] Warning: Could not resolve SRV URI programmatically: ${err.message}.`);
    return uri;
  }
}

// Connect to MongoDB
try {
  const resolvedUri = await resolveSrvConnectionString(MONGODB_URI);
  console.log(`Connecting to MongoDB...`);
  await mongoose.connect(resolvedUri, {
    dbName: 'KoinX',
    serverSelectionTimeoutMS: 5000
  });
  console.log('MongoDB connected successfully to primary URI.');
  useMongo = true;
} catch (error) {
  console.warn(`Connection to primary MONGODB_URI failed: ${error.message}`);
  // Try local fallback to show data in user's local Compass
  const LOCAL_MONGODB_URI = 'mongodb://127.0.0.1:27017/KoinX';
  try {
    console.log(`Attempting connection to local MongoDB fallback at: ${LOCAL_MONGODB_URI}...`);
    await mongoose.connect(LOCAL_MONGODB_URI, {
      dbName: 'KoinX',
      serverSelectionTimeoutMS: 5000
    });
    console.log('Connected to local MongoDB successfully.');
    useMongo = true;
  } catch (localError) {
    console.warn('Local MongoDB connection failed too. Falling back to local JSON file database.');
    console.error(`Local error details: ${localError.message}`);
    useMongo = false;
  }
}

const db = {
  isMongo: () => useMongo,
  mongoose
};

export default db;
