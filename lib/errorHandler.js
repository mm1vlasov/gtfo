const { MessageFlags } = require('discord.js');

class ErrorHandler {
    static async handleInteractionError(interaction, error, context = '') {
        console.error(`[Error${context ? ` ${context}` : ''}]:`, error);

        const reply = {
            content: 'Произошла ошибка при выполнении операции.',
            flags: MessageFlags.Ephemeral
        };

        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp(reply).catch(() => { });
            } else {
                await interaction.reply(reply).catch(() => { });
            }
        } catch (replyError) {
            console.error('[Error] Failed to send error message:', replyError);
        }
    }

    static log(message, context = 'Info') {
        console.log(`[${context}] ${message}`);
    }

    static error(error, context = 'Error') {
        console.error(`[${context}]`, error);
    }
}

module.exports = ErrorHandler;
