# User API, Stage 2

## Requirements:

For this assignment, you will be adding the necessary middleware to your API to implement
authentication and access control using JSON Web access and refresh tokens.

First, make sure that your stage 1 works and passes all the tests. Although you should start
over with a new git repository, you should carry over and reuse your stage 1 implementation
of REST API calls as needed for this stage.

In this stage, you'll add authentication and authorization to your API.  
Authentication will be based using [JSON Web Tokens](https://jwt.io/), presented by the
client in the form of Bearer tokens. We recommend that you read the information on the
front page of [jwt.io](https://jwt.io) first.

For authorization, we support access control based on 3 roles:

- unauthenticated users
- regular users
- administrative users (admin)

Based on these roles, calls to the following endpoints should have the following access
controls implemented:

**Admin only**

    GET     /api/users       Lists all users
    DELETE  /api/users       Delete the entire user database

**Admin or regular user with matching `id`**

    GET     /api/users/:id   Retrieve a user's information
    PUT     /api/users/:id   Update a user's information
    DELETE  /api/users/:id   Delete a user identified by its id
    POST    /api/refresh     Refresh a JWT access token

**No authentication**

    POST    /api/users       Create a new user and return its id
    POST    /api/login       Authenticate a regular user or admin using a password
                             and return access and refresh tokens

## JSON Web Tokens

When a user submits their username and password to the `/api/login` endpoint, the server verifies
that the submitted password matches the stored hash via bcrypt.compare. If it does, the server
will return two tokens as part of its response.

The first token is an access token. This access token will contain information about
the user, such as name, admin status, etc. along with metadata such as when the token was
issued and when it is going to expire.

Clients will present their access token on future requests to prove that they have authenticated
successfully. Specifically, clients will send tokens using a

    Authorization: Bearer xyz

header in each HTTP request, where `xyz` represents their JWT access token. The server must
check whether the token is valid and has not expired. If so, the server will grant access.
Token are cryptographically signed; the signature is computed over both the token's content and a
secret key known only to the server. Thus, the client cannot forge or manufacture tokens, and the
server can verify whether an access token that is presented was previously given to a client (based
on the secret key). You can use the [jwt.io Debugger](https://jwt.io/#debugger) to see what's in
a token.

For the purposes of this project, we will use the [@fastify/jwt](https://www.npmjs.com/package/@fastify/jwt)
package to create JWT tokens, which internally uses [fast-jwt](https://www.npmjs.com/package/fast-jwt).

An advantage of using access tokens is that the server doesn't have to consult any
session state when making an access control decision - the information in the token
is often enough to make this decision. On the flipside, this means that these tokens,
if compromised, could be used by an attacker. For this reason, they are short-lived.
After they expire, the client must replace ("refresh") them to obtain a new access token.

This refresh occurs with the help of a refresh token which is also issued upon successful
authentication. This refresh token is also a JWT token (although any cryptographically
secure opaque token could be used here). Unlike for access tokens, the server must remember
which refresh token it issued. It can do so by generating a unique ID for each token (jti)
that is used as a key to look up the token. Refresh tokens are one-time use: when one is
used to obtain a new access token, it is retired ("revoked") and a new one is issued in
its place.

To increase resiliency, the server will also remember old, already revoked tokens.
All tokens that were issued on behalf of the same user are part of a family in that
they share the jit of the first refresh token as their family id. If the server detects
an attempt to reuse an already revoked token, it will revoke all refresh tokens in that
family (ordinarily, the family should have at most once unrevoked token.)

## fastify lifecycle and decorators

Fastify's request processing can be extended using by adding handlers to various
stages of the request [processing lifecycle](https://fastify.dev/docs/latest/Reference/Lifecycle/).
This idea is known in other servers as _middleware_. For instance, during the `preHandler`
stage, a function can be called that ensures that the user is authenticated.
In fastify, such functions should first be added as an additional property
to the `fastify` object, which is referred to as a decorator.

This decoration process is used solely for performance reasons. Even though JavaScript
allows adding properties to any object at any time, the just-in-time compiler of the v8
JS virtual machine can generate faster code if an object's shape stays constant
wherever it is used (this will allow a layout of an object somewhat similar to a C object
with constant offsets for each property in the object and dispatch table, respectively).
This motivation explains fastify's process of first decorating `fastify` before using
its properties.

A similar decoration process takes place for the `user` object, which is added by the
authentication prehandlers.

For the assignment, I am providing a skeleton of my own handmade implementation.
The unit tests are created and/or extended by an agent AI to test the implementation.

## Note: username/name API change

A change that was made from stage 1 concerns the labeling of the
username field representing the name the user uses to log in. In all API
requests, this field is labeled `username`; however, in the csv-based
database, the field is still called `name`.

The database is now able to support changes to this field when `.save()`
is called. However, since the username must be unique, attempts to change
the username such that the result would no longer be unique should be
rejected with a 409 error.

## Linting and formatting:

Setup, linting, and formatting are as in the previous project using
ESLint and Prettier as per `eslint.config.js` and `.prettierrc`. You
may add additional rules, but you may not remove any.

When you're done, running `npm run formatcheck` and `npm run lint`
should not output any errors.

## Submission

You will be submitting the entire project directory, but you may
not make changes to the tests file we provide. To submit, please commit your
changes to your clone, push them to your fork on git.cs.vt.edu.

Use `git archive` to prepare a tar file for submission:

```bash
git archive --format=tar --output=api-stage-2.tar --prefix=<yourpid>-api-stage-2/ yourbranch
```

For instance, if your pid were `gback` and you had committed your changes to a
`master` branch, it would be:

```bash
git archive --format=tar --output=api-stage-2.tar --prefix=gback-api-stage-2/ master
```

Then you upload api-stage-2.tar as part of your submission.

When done, prepare a presentation (no more than 5 slides) and record
a video of yourself narrating your presentation; no more than 4 minutes.
These limits will be strictly enforced.
In your narrated presentation, discuss

- what this exercise was about (a synopsis)
- what you learned about JWT
- how access and refresh tokens interact to ensure authentication
- how you used fastify to implement them
- describe whether or not you made use of generative AI in creating your solution

-- created by gback Feb 2026
