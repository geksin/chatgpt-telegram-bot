import dotenv from 'dotenv';
import { Telegraf } from 'telegraf';
import axios from 'axios';
import { Configuration, OpenAIApi } from 'openai';
import showdown from 'showdown';

dotenv.config();

const converter = new showdown.Converter();

// Пока не испоьлзуется, возможно понадобится, если буду делать web морду
const getHtmlfromMarkdown = (text) => converter.makeHtml(textStr);

// Аккаунты, которые могут писать этому боту, перечисленые через , (без @) в .env файле
// Если ACCOUNTS_WHITE_LIST пустая - бот будет отвечать всем
const accounts = (process.env.ACCOUNTS_WHITE_LIST || '').trim().split(',');

const configuration = new Configuration({
  apiKey: process.env.GPT_API_KEY,
});

const openai = new OpenAIApi(configuration);

const roles = {
    System: 'system',
    User: 'user',
    Assistant: 'assistant', 
}

const defaultRole = 'programmer';

// Изначальный контекст задается с помощью роли system
// https://platform.openai.com/docs/guides/chat/introduction
const assistantContext = {
    programmer: [
        { role: roles.System, content: 'Ты помогаешь решать задачи программирования и всегда объяснаяешь все максимально подробно и прикладываешь ссылки' },
    ],
    designer: [
        { role: roles.System, content: 'Ты очень творческая натура и общаешься в френдли стиле, готов генерировать новые и смелые идеи' },
    ],
    buddy: [
        { role: roles.System, content: 'Ты лучший друг и всегда добавляешь слово Дружище при обращении' },
    ]
};

// callback_data должна быть ключем assistantContext
// Чтобы добавить роль, ее нужно описать и в assistantContext и в roleButtons
const roleButtons = [
    [ { text: "Программист", callback_data: "programmer" }],
    [ { text: "Дизайнер", callback_data: "designer" }],
    [ { text: "Дружбан", callback_data: "buddy" }],
];

// Тут храним контекст сообщений для каждого чата
const messagesStore = new Map();

// Тут храним роль для ассистента для каждого чата
const assistantInitialContextStore = new Map();

// TODO: Нормально обработать завезервированные символы
const sendReply = (ctx, choices) => {
    const textStr = choices.map(({ message }) => message.content).join('\n');

    ctx.reply(textStr
            .replace(/\./g, "\\.")
            .replace(/\-/g, "\\-")
            .replace(/\(/g, "\\(")
            .replace(/\)/g, "\\)")
            .replace(/\!/g, "\\!")
        , { parse_mode: 'MarkdownV2' })
        .catch((error) => {
            // TODO: Добавить нормальный логгер
            // error?.response?.description || 'Unexpected error'
            console.log('Error: ', error?.response?.description || error);
            ctx.reply(textStr);
        })
}

const accessDenied = (ctx) => {
    ctx.reply('Извини, я тебя не знаю...')
}

const requestAssist = async (messages = []) => {
    try {
        const { data } = await openai.createChatCompletion({
            model: 'gpt-3.5-turbo',
            messages: messages
        });
    
        return data;
    } catch (error) {
        return { choices: [], error: error }
    }
};

/**
 * Получение iam токена https://cloud.yandex.ru/docs/iam/operations/iam-token/create
 * @returns {Promise<{ iamToken: string; expiresAt?: string }>}
 */
const getIamToken = async () => {
    try {
        const { data } = await axios.post('https://iam.api.cloud.yandex.net/iam/v1/tokens', {
            yandexPassportOauthToken: process.env.YA_PASSPORT_TOKEN
        });
        return data;
    } catch (err) {
        console.log('Error get iam token: ', err.response.description || err.message)
        return { iamToken: null };
    }
}

getIamToken();

// Концепции https://cloud.yandex.ru/docs/iam/concepts/authorization/iam-token
const iamToken = {
    value: null,
    async runUpdates() {
        const { iamToken } = await getIamToken();
        this.value = iamToken;
        const interval = setInterval(async () => {
            const { iamToken: intervalToken } = await getIamToken();
            this.value = intervalToken;
        }, 1000 * 60 * 60); // Раз в час выписываем новый iam токен, потому что он протухает за 12 часов
        return interval;
    }
}

const replyWithRoles = (ctx) => {
    ctx.reply('Выбери роль ассистента: ', {
        reply_markup: {
            inline_keyboard: roleButtons
        } 
    });
}

const recognizeVoice = async (buffer) => {
    const response = await axios({
        method: 'post',
        url: `https://stt.api.cloud.yandex.net/speech/v1/stt:recognize?folderId=${process.env.BUCKET_ID}&lang=ru-RU`,
        headers: {
          Authorization: `Bearer ${iamToken.value}`,
          'Content-Type': 'application/octet-stream'
        },
        data: buffer
      });
    return response.data?.result || 'Не распознано' ;
};


const sendMessageToChatGpt = async (ctx, message, id) => {
    const assistantRole = assistantInitialContextStore.get(id) || defaultRole;

    console.debug('Send request: ', message, assistantRole);

    const initialContext = [
        ...assistantContext[assistantRole]
    ];

    let messages = messagesStore.get(id) || initialContext;

    messages = [
        ...messages,
        { role: roles.User, content: message }
    ];

    console.dir(messages);

    const help = await requestAssist(messages);
    const { choices, error } = help;

    if (error) {
        console.debug(error);
        ctx.replyWithHTML(`Произошла ошибка, попробуйте начать заново: <code>/start</code>`);
        messagesStore.delete(id);
        return;
    }

    messages = [
        ...messages,
        ...choices.map(({ message }) => ({ role: message.role, content: message.content }))
    ];

    messagesStore.set(id, messages);

    return choices;
}

const runBot = () => {

    const bot = new Telegraf(process.env.BOT_API_KEY);

    bot.on('callback_query', (ctx) => {
        const username = ctx.update.callback_query.message.chat.username;
        if (accounts.length && !accounts.includes(username)) {
            accessDenied(ctx);
            return;
        }
        const data = ctx.update.callback_query.data;
        const id = ctx.update.callback_query.from.id;

        if (assistantContext[data]) {
            ctx.reply('Выбрана роль: ' + data + ', весь предыдущий контекст забывается...');
            assistantInitialContextStore.set(id, data);
            messagesStore.delete(id);
            return;
        }

        ctx.reply('Неизвестная команда: ' + data);
        
    });

    bot.on('text', async (ctx) => {
        if (accounts.length && !accounts.includes(ctx.message.from.username)) {
            accessDenied(ctx);
            return;
        }
        switch(ctx.message.text) {
            case '/start':
                if (messagesStore.has(ctx.message.from.id)) {
                    messagesStore.delete(ctx.message.from.id);
                }
                replyWithRoles(ctx);
                break;
            case '/role':
                replyWithRoles(ctx);
                break;
            default:
                // Все команды обработаны в case выше
                if (ctx.message.text.startsWith('/')) {
                    ctx.reply('Неизвестная команда: ' + ctx.message.text);
                    return;
                }
                const choices =  await sendMessageToChatGpt(
                    ctx,
                    ctx.message.text,
                    ctx.message.from.id
                );
                sendReply(ctx, choices);
        }
    });

    bot.on('voice', (ctx) => {
        if (accounts.length && !accounts.includes(ctx.message.from.username)) {
            accessDenied(ctx);
            return;
        }
        const { voice, from } = ctx.message;
        const { id } = from;
        const { file_id } = voice;
        ctx.replyWithHTML(`<code>Обрабатываю запрос...</code>`);
        ctx.telegram.getFileLink(file_id).then(async (fileLink) => {
            // Получаем ссыль на голосовое сообщение
            const { href } = fileLink;
 
            try {
                // Получаем данные в ArrayBuffer и их же передаем в Yandex Speech Kit
                const { data: voiceBuffer } = await axios.get(href, { responseType: 'arraybuffer' });
                // Таким образом обходимся без установки ffmpeg и
                // Промежуточного сохранения и конвертирования файла
                const propmt = await recognizeVoice(voiceBuffer);
                ctx.replyWithHTML(`<code>Запрос: ${propmt}</code>`);
                const choices = await sendMessageToChatGpt(
                    ctx,
                    propmt,
                    id
                );
                sendReply(ctx, choices);
            } catch (error) {
                console.log('Failed voice recognition: ', error.response.data.description || error.message);
                ctx.reply(`Что-то пошло не так, попробуй общаться с помощью текста, мы это починим...`)
            }
        });
    });

    bot.launch();
}

iamToken.runUpdates()
    .then(_updateTimer => { // Можно отписаться от интервала обновления токенов 
        runBot();
    });