import { Handler } from '@netlify/functions';

const Knex = require('knex');
const knexServerlessMysql = require('knex-serverless-mysql');

const mysql = require('serverless-mysql')({
  config: {
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
  },
});

const knex = Knex({
  client: knexServerlessMysql,
  mysql,
});

const makeError = (message: string) => ({
  statusCode: 200,
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    errors: [
      {
        status: 200,
        detail: message,
      },
    ],
  }),
});

const makeResponse = (message: string, type: string = 'puzzle') => ({
  statusCode: 200,
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    data: {
      type,
      attributes: {
        message,
      },
    },
  }),
});

const handler: Handler = async (event, context) => {
  const { data } = JSON.parse(event.body) || {};
  const { attributes } = data || {};

  if (!attributes) {
    return makeError('Missing attributes');
  }

  const { answer, username } = attributes;

  let user = await knex('users').where({ username }).first();

  if (!user) {
    await knex('users').insert({ username });
    user = await knex('users').where({ username }).first();
  }

  const puzzle = await knex('puzzles')
    .select('*')
    .where('opens_at', '<', new Date().toISOString())
    .andWhere('closes_at', '>', new Date().toISOString())
    .first();

  if (!puzzle) {
    return makeError('No puzzle is currently open');
  }

  const responses = await knex('solve_attempts').where({
    user_id: user.id,
    puzzle_id: puzzle.id,
    correct: true,
  });

  const insertResponse = async (stage: number, correct: boolean = false) => {
    await knex('solve_attempts').insert({
      user_id: user.id,
      puzzle_id: puzzle.id,
      stage,
      correct,
    });
  };

  const validatePuzzleResponse = async (stage: number) => {
    const stageColumn = stage === 1 ? `stage_one_solution` : `stage_two_solution`;
    if (puzzle[stageColumn].trim() === answer.trim()) {
      await insertResponse(stage, true);
      return stage === 1
        ? makeResponse(
            `**Correct!** Now solve part 2 to be a true puzzle master: ${puzzle.stage_two_clue}`,
            'puzzle',
          )
        : makeResponse('You solved it!', 'completion_message');
    }

    await insertResponse(stage);
    return makeError(`Not quite. But you're welcome to try again!`);
  };

  if (!responses.length) {
    return validatePuzzleResponse(1);
  }

  if (responses.length === 1) {
    return validatePuzzleResponse(2);
  }

  return makeError('You have already solved this puzzle');
};

export { handler };
