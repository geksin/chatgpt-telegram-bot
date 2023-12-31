import { cleanSpecialSymbols } from './common.js';
import { getCharactersButtons, languageButtons, programmingLangButtons, langDefault } from '../constants/index.js';
import { vocalizeText } from './yandex.js';
import { tt } from '../utils/logger.js';

export const sendReplyFromAssistant = (ctx, choices) => {
    const textStr = (choices || []).map(({ message }) => message.content).join('\n');

    if (textStr)
        ctx.reply(cleanSpecialSymbols(textStr), { parse_mode: 'MarkdownV2' })
            .catch((error) => {
                tt`w!Can't send reply from assistant, send with text${error}`
                ctx.reply(textStr).catch((err) => tt`!Can't send reply with text after error${err}`);
            })
}

/**
 * 
 * Ответ голосом все кроме блоков кода, код скинет в чат
 * 
 * @param {import('telegraf').Context} ctx 
 * @param {Array<{ voiceData: { texts: string[]; codeBlocks: string[] } }>} choices
 * @param {import('i18next')} i18next
 * @param {keyof typeof import('../constants/index.js').characters} character
 */
export const sendVoiceAssistantResponse = async (ctx, choices, i18next, character) => {
    for (const choice of choices) {
        const { texts, codeBlocks } = choice.voiceData;
        while (texts.length) {
            const voiceMessage = texts.shift();
            if (!voiceMessage)
                continue;

            tt`d!sendVoiceAssistantResponse${{voiceMessage, lang: i18next.language}}`

            const voiceBuff = await vocalizeText(voiceMessage, i18next.language, character);
            voiceBuff && await ctx.replyWithVoice({ source: voiceBuff });
            if (codeBlocks.length) {
                const codeBlock = codeBlocks.shift();
                codeBlock && await ctx.reply(cleanSpecialSymbols(codeBlock), { parse_mode: 'MarkdownV2' })
                    .catch((err) => {
                        tt`!sendVoiceAssistantResponse: Can\'t send message to user ${getReplyId(ctx)} ${err}`
                    })
            }
        }
        while (codeBlocks.length) { // По идее сюда управление уже не должно перейти
            const codeBlock = codeBlocks.shift();
            codeBlock && await ctx.reply(cleanSpecialSymbols(codeBlock), { parse_mode: 'MarkdownV2' })
                .catch((err) => {
                    tt`!sendVoiceAssistantResponse: Can\'t send message to user ${getReplyId(ctx)} ${err}`
                })
        }
    }
}


/**
 * @param {import('telegraf').Context} ctx 
 */
export const getReplyId = (ctx) => {
    if (ctx.message)
        return ctx.message.from.id;
    
    return ctx.update?.callback_query?.from.id
}

/**
 * @param {import('telegraf').Context} ctx 
 */
export const getUsername = (ctx) => {
    if (ctx.message)
        return ctx.message.from.username;
    
    return ctx.update?.callback_query?.message?.chat?.username
}

/**
 * @param {import('telegraf').Context} ctx 
 * @param {import('i18next')} i18next
 * @param {Map<number, Object>} chatContextStore
 */
export const setUserLanguage = async (ctx, i18next, chatContextStore) => {
    const lang = chatContextStore.get(getReplyId(ctx))?.lang || langDefault;
    await i18next.changeLanguage(lang);
}

/**
 * @param {import('telegraf').Context} ctx 
 * @param {import('i18next')} i18next 
 */
export const accessDenied = async (ctx, i18next, chatContextStore) => {
    await setUserLanguage(ctx, i18next, chatContextStore);
    ctx.reply(i18next.t('system.messages.unknown-chat'))
        .catch((err) => {
            tt`!accessDenied: Can\'t send message to user: ${getReplyId(ctx)} ${err}`
        })
}

/**
 * @param {import('telegraf').Context} ctx 
 * @param {import('i18next')} i18next 
 */
export const replyWithRoles = (ctx, i18next) => {
    ctx.reply( i18next.t('system.messages.choose-character') + ': ', {
        reply_markup: {
            inline_keyboard: getCharactersButtons(i18next.t, i18next.language)
        }
    }).catch((err) => tt`!replyWithRoles: Can\'t send message to user: ${getReplyId(ctx)} ${err}`)

}

/**
 * @param {import('telegraf').Context} ctx 
 * @param {import('i18next')} i18next 
 */
export const replyWithProgrammingLanguages = async (ctx, i18next) => {
    await ctx.replyWithHTML('<code>🥷</code>');
    ctx.reply(i18next.t('system.messages.choose-programming-language') + ': ', {
        reply_markup: {
            inline_keyboard: programmingLangButtons
        },
    })
    .catch((err) => tt`!replyWithProgrammingLanguages: Can\'t send message to user:${getReplyId(ctx)} ${err}`)
}

/**
 * @param {import('telegraf').Context} ctx 
 * @param {import('i18next').t} t 
 */
export const replyWithLanguageButtons= (ctx, t) => {
    ctx.reply(t('system.messages.choose-lang') + ': ', {
        reply_markup: {
            inline_keyboard: [
                languageButtons
            ]
        }
    })
    .catch((err) => tt`!replyWithLanguageButtons: Can\'t send message to user:${getReplyId(ctx)} ${err}`)
}

/**
 * @param {import('telegraf').Context} ctx 
 * @param {import('i18next').t} t 
 */
export const replyWithVoiceButtons= (ctx, t) => {
    ctx.reply(t('system.messages.voice-reply') + ': ', {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: 'Да', callback_data: 'enable_voice_response' },
                    { text: 'Нет', callback_data: 'disable_voice_response' },
                ]
            ]
        }
    })
    .catch((err) => tt`!replyWithVoiceButtons: Can\'t send message to user:${getReplyId(ctx)} ${err}`)
}

/**
 * @param {import('telegraf').Context} ctx 
 * @param {import('i18next').t} t
 * @param {string} model
 */
export const replyWithModel= (ctx, t, model) => {
    ctx.reply(t('system.messages.model-reply', {
        model
    }))
    .catch((err) => tt`!replyWithModel: Can\'t send message to user:${getReplyId(ctx)} ${err}`)
}

/**
 * @param {import('telegraf').Context} ctx 
 * @param {import('i18next').t} t
 */
export const replyWithImagePropmt= (ctx, t) => {
    // FIXME: вынести в ключи локализации
    ctx.reply('Введите описание для генерации картинки')
    .catch((err) => tt`!replyWithImagePropmt: Can\'t send message to user:${getReplyId(ctx)} ${err}`)
}


