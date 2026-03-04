/*
 * Simple csv-file backed user database.
 * Except for getById and getByName, all methods are async and
 * return a promise.
 *
 * Handcrafted by godmar@gmail.com, 2026
 */
import * as fs from 'node:fs';
import * as csvreader from '@fast-csv/parse';
import * as csvwriter from '@fast-csv/format';

interface User {
  id?: number;
  admin?: boolean;
  name: string;
  password: string;
  fullname: string;
}

interface UserDatabase {
  byName: Map<string, User>;
  byId: Map<number, User>;
  save: () => Promise<boolean>;
  getByName: (name: string) => User;
  getById: (id: number) => User;
  add: (user: User) => Promise<number>;
  delete: (id: number) => Promise<boolean>;
  clear: () => void;
}

export default (userdbfilename: string) =>
  new Promise<UserDatabase>((fulfill, reject) => {
    const users = {
      nextid: 0,
      byName: new Map(),
      byId: new Map(),
      /* Save user database to a .csv file */
      save: function () {
        return new Promise<boolean>((fulfill, reject) => {
          const writer = csvwriter.format({
            headers: ['id', 'admin', 'name', 'password', 'fullname'],
          });
          // check if any names were changed and if so, reindex
          // the new name in the byName and remove the old one
          // Still maintain byName as a unique index.
          const names_removed = [];
          const names_added = [];
          for (const [name, user] of this.byName) {
            if (name !== user.name) {
              if (this.byName.has(user.name)) {
                reject('duplicate user name');
                return;
              }
              names_removed.push(name);
              names_added.push([user.name, user]);
            }
          }
          for (const [name, user] of names_added) this.byName.set(name, user);
          for (const name of names_removed) this.byName.delete(name);

          const outputfile = fs.createWriteStream(userdbfilename);
          writer.pipe(outputfile);
          for (const [_name, user] of this.byName) {
            writer.write([
              user.id,
              user.admin,
              user.name,
              user.password,
              user.fullname,
            ]);
          }
          writer.end();
          writer.on('error', () => {
            reject();
          });
          outputfile.on('error', () => {
            reject();
          });
          outputfile.on('finish', () => {
            fulfill(true);
          });
        });
      },
      /* Retrieve user by name. */
      getByName: function (name: string) {
        return this.byName.get(name);
      },
      /* Retrieve user by id. */
      getById: function (id: number) {
        return this.byId.get(id);
      },
      /*
       * Add a user, assign an id, return the id upon successful save
       */
      add: async function (user: User) {
        user.id = this.nextid++;
        this.byName.set(user.name, user);
        this.byId.set(user.id, user);
        await this.save();
        return user.id;
      },
      /*
       * Delete a user with a given (numeric) id
       */
      delete: function (id: number) {
        const user = this.byId.get(id);
        this.byName.delete(user.name);
        this.byId.delete(user.id);
        return this.save();
      },
      /*
       * Clear the user database.
       */
      clear: function () {
        this.nextid = 0;
        this.byName.clear();
        this.byId.clear();
        return this.save();
      },
    };
    /* Read existing database, if any */
    fs.createReadStream(userdbfilename)
      .on('error', (err: NodeJS.ErrnoException) => {
        // any error except "file not found" will lead to rejection
        if (err.code == 'ENOENT') {
          fulfill(users);
        } else {
          reject(err);
        }
      })
      .pipe(csvreader.parse({ headers: true }))
      .on('data', (user) => {
        user.id = Number(user.id);
        users.byName.set(user.name, user);
        users.byId.set(user.id, user);
        if (user.id >= users.nextid) {
          users.nextid = user.id + 1;
        }
      })
      .on('end', () => {
        fulfill(users);
      })
      .on('error', (err) => {
        reject(err);
      });
  });
