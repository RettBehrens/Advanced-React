const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomBytes } = require('crypto');
const { promisify } = require('util');
const { transport, makeANiceEmail } = require('../mail');
const { hasPermission } = require('../utils');

const Mutations = {
  async createItem(parent, arguments, context, info) {
    if (!context.request.userId) {
      throw new Error('You must be logged in to do that!');
    }
    const item = await context.db.mutation.createItem(
      {
        data: {
          user: {
            connect: {
              id: context.request.userId
            }
          },
          ...arguments
        }
      },
      info
    );
    return item;
  },
  updateItem(parent, arguments, context, info) {
    const updates = { ...arguments };
    delete updates.id;
    return context.db.mutation.updateItem(
      {
        data: updates,
        where: {
          id: arguments.id
        }
      },
      info
    );
  },
  async deleteItem(parent, arguments, context, info) {
    const where = { id: arguments.id };
    const item = await context.db.query.item(
      { where },
      `
        {
          id
          title
          user {
            id
          }
        }
      `
    );
    const ownsItem = item.user.id === context.request.userId;
    const hasPermissions = context.request.user.permissions.some(permission =>
      ['ADMIN', 'ITEMDELETE'].includes(permission)
    );
    if (!ownsItem && !hasPermissions) {
      throw new Error("You don't have permission to do that!");
    }
    return context.db.mutation.deleteItem({ where }, info);
  },

  async signup(parent, arguments, context, info) {
    arguments.email = arguments.email.toLowerCase();
    const password = await bcrypt.hash(arguments.password, 10);
    const user = await context.db.mutation.createUser(
      {
        data: { ...arguments, password, permissions: { set: ['USER'] } }
      },
      info
    );
    const token = jwt.sign({ userId: user.id }, process.env.APP_SECRET);
    context.response.cookie('token', token, {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 365
    });
    return user;
  },

  async signin(parent, { email, password }, context, info) {
    const user = await context.db.query.user({ where: { email } });
    if (!user) {
      throw new Error(`No such user found for email ${email}`);
    }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      throw new Error('Invalid Password!');
    }
    const token = jwt.sign({ userId: user.id }, process.env.APP_SECRET);
    context.response.cookie('token', token, {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 365
    });
    return user;
  },

  signout(parent, arguments, context, info) {
    context.response.clearCookie('token');
    return { message: 'Goodbye!' };
  },

  async requestReset(parent, arguments, context, info) {
    const user = await context.db.query.user({
      where: { email: arguments.email }
    });
    if (!user) {
      throw new Error(`No such user found for email ${arguments.email}`);
    }
    const resetToken = (await promisify(randomBytes)(20)).toString('hex');
    const resetTokenExpiry = Date.now() + 3600000;
    const res = await context.db.mutation.updateUser({
      where: { email: arguments.email },
      data: { resetToken, resetTokenExpiry }
    });
    const mailRes = await transport.sendMail({
      from: 'rett@rettbehrens.codes',
      to: user.email,
      subject: 'Your Password Reset Token',
      html: makeANiceEmail(`Your Password Reset Token is here!
      \n\n
      <a href='${
        process.env.FRONTEND_URL
      }/reset?=${resetToken}'>Click Here to Reset</a>
      `)
    });
    return { message: 'Thanks!' };
  },

  async resetPassword(parent, arguments, context, info) {
    if (arguments.password !== arguments.confirmPassword) {
      throw new Error("Yo passwords don't match!");
    }
    const [user] = await context.db.query.users({
      where: {
        resetToken: arguments.resetToken,
        resetTokenExpiry_gte: Date.now() - 3600000
      }
    });
    if (!user) {
      throw new Error('This token is either invalid or expired!');
    }
    const password = await bcrypt.hash(arguments.password, 10);
    const updatedUser = await context.db.mutation.updateUser({
      where: { email: user.email },
      data: {
        password,
        resetToken: null,
        resetTokenExpiry: null
      }
    });
    const token = jwt.sign({ userId: updatedUser.id }, process.env.APP_SECRET);
    context.response.cookie('token', token, {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 365
    });
    return updatedUser;
  },

  async updatePermissions(parent, arguments, context, info) {
    if (!context.request.userId) {
      throw new Error('You must be logged in!');
    }
    const currentUser = await context.db.query.user(
      { where: { id: context.request.userId } },
      info
    );
    hasPermission(currentUser, ['ADMIN', 'PERMISSIONUPDATE']);
    return context.db.mutation.updateUser(
      {
        data: {
          permissions: {
            set: arguments.permissions
          }
        },
        where: {
          id: arguments.userId
        }
      },
      info
    );
  },

  async addToCart(parent, arguments, context, info) {
    const { userId } = context.request;
    if (!userId) {
      throw new Error('You must be signed in');
    }
    const [existingCartItem] = await context.db.query.cartItems({
      where: {
        user: {
          id: userId
        },
        item: {
          id: arguments.id
        }
      }
    });
    if (existingCartItem) {
      return context.db.mutation.updateCartItem(
        {
          where: {
            id: existingCartItem.id
          },
          data: {
            quantity: existingCartItem.quantity + 1
          }
        },
        info
      );
    }
    return context.db.mutation.createCartItem(
      {
        data: {
          user: {
            connect: {
              id: userId
            }
          },
          item: {
            connect: {
              id: arguments.id
            }
          }
        }
      },
      info
    );
  },

  async removeFromCart(parent, arguments, context, info) {
    const cartItem = await context.db.query.cartItem(
      {
        where: {
          id: arguments.id
        }
      },
      `{ id, user { id } }`
    );
    if (!cartItem) throw new Error('No Cart Item Found!');
    if (cartItem.user.id !== context.request.userId) {
      throw new Error('Cheating huh?');
    }
    return context.db.mutation.deleteCartItem(
      {
        where: { id: arguments.id }
      },
      info
    );
  }
};

module.exports = Mutations;
