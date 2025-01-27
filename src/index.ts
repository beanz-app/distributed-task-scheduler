import { R } from './streams';
import { MongoClient } from 'mongodb';
import { startTasksManager } from './services/TasksManager';
import Koa from 'koa';
import koaBody from 'koa-body';
import { errorHandler, healthCheckHandler, tokenHandler } from './utils/middlewares';
import { loggerHandler } from './utils/middlewares/loggerHandler';
import { config } from './config';
import loggerFactory from './utils/logging';
import tasksRoute from './routes/tasksRoute';
import path from 'path';
import { getUnitOfWorkHandler } from './utils/middlewares/unitOfWorkHandler';
import { getDbClient } from './utils/getDbClient';

const logger = loggerFactory.getLogger('Index');
logger.trace('Started ...');
const app = new Koa();
const serverStatus = {
  ready: false,
  live: false
};
let dbClient: MongoClient;
let server: import('http').Server;

const stopables: { stop: () => Promise<void> }[] = [];

(async () => {

  app.proxy = true;
  app.use(healthCheckHandler(serverStatus));
  app.use(loggerHandler);

  // Token Handler!
  app.use(tokenHandler);

  // Error Handler!
  app.use(errorHandler);

  // Body Parser ...
  app.use(koaBody());
  app.use(getUnitOfWorkHandler());

  app.use(tasksRoute().mount(path.join('/', config.apiPrefix, '/tasks')));

  server = app.listen(config.port, () => {
    console.info(`application is listening on port ${config.port} ...`);
  });

  dbClient = await getDbClient();
  stopables.push(
    await R.startAll(),
    await startTasksManager()
  );

  serverStatus.ready = true;
  serverStatus.live = true;
  console.info(`Service is live ...`);

})().catch((err) => {
  serverStatus.live = false;
  console.error('fatal', err);
  teardown('fatal');
});;

function teardown(signalText: string, signal?: NodeJS.Signals) {
  console.log('teardown: (signal):', signalText, signal);
  const afterClose = async (err?: Error) => {
    try {
      if (err) {
        console.error('teardown: (server close error):', JSON.stringify(err));
      }
      if (stopables) await Promise.all(stopables.map(s => s.stop()));
      if (err) {
        console.error('teardown: (server close error):', JSON.stringify(err));
        process.exit(2);
      } else {
        console.log('teardown: clean exit (0)');
        process.exit(0);
      }
    } catch (innerError) {
      console.error('teardown: (close error):', JSON.stringify(err));
      process.exit(3);
    }
  };
  if (server && server.listening) {
    server.close((err) => afterClose(err));
  } else {
    afterClose();
  }
}


process.on('SIGTERM', s => {
  teardown('SIGTERM', s);
});
process.on('SIGINT', s => {
  teardown('SIGINT', s);
});
process.on('SIGHUP', s => {
  teardown('SIGHUP', s);
});
process.on('exit', s => {
  teardown('exit');
});
