require('dotenv').config();
const fetch = require('node-fetch');
const fs = require("fs");
const fse = require('fs-extra');
const path = require('path');
const { exit } = require('process');

let timeoutCounter = 0
const TIMEOUT_LIMIT = 20

function log(str) {
    const date = new Date()
    console.log(`(UTC/GMT${(-1)*date.getTimezoneOffset()/60}) ${date.toLocaleString()} |> ${str}`)
}

async function isValidToken(token) {
    const res = await fetch("https://id.twitch.tv/oauth2/validate",
        {
            "method": "GET",
            "headers": {
                "Authorization": `OAuth ${token}`
            }
        }
    )
    if (res.status != 200) return false
    const json = await res.json()
    if (json.expires_in < (60*5)) return false // if less than 5 mins left on token
    return true
}

async function generateToken(client_id, client_secret) {
    const res = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${client_id}&client_secret=${client_secret}&grant_type=client_credentials`,
        {
            "method": "POST"
        }
    )
    if (res.status != 200) return null
    return await res.json()
}

function writeTokenFile(token) {
    fs.writeFileSync(".token", token)
}

function readTokenFile() {
    if (fs.existsSync(".token")) {
        const token = fs.readFileSync(".token", {encoding:'utf8'})
        return token
    }
    return null

}

async function getToken() {
    let token = readTokenFile()
    if (token == null) {
        log("Token file not found! Generating new token and writing it to file!")
        token = (await generateToken(process.env.CLIENT_ID, process.env.CLIENT_SECRET)).access_token
        writeTokenFile(token)
        return token
    }
    if (await isValidToken(token)) {
        return token
    } else {
        log("Token invalid! Generating new token and writing to file!")
        token = (await generateToken(process.env.CLIENT_ID, process.env.CLIENT_SECRET)).access_token
        writeTokenFile(token)
        return token
    }
}

function logVod(data) {
    const streamers = JSON.parse(fs.readFileSync("streamers.json", {encoding:'utf8'}))
    const username = streamers[data.user_id]

    if (!fs.existsSync(`vods/${username}`)) {
        log(`Creating ${username} folder!`)
        fs.mkdirSync(`vods/${username}`)
    }

    const fileName = `${data.published_at.split("T")[0]}_${data.id}.json`
    if (!fs.existsSync(`vods/${username}/${fileName}`)) {
        log(`Logging new vod: ${username}/${fileName}`)
        const thumbnail_url_split = data.thumbnail_url.split("/")
        data["hidden_url"] = {
            "subdomain": thumbnail_url_split[4],
            "path": thumbnail_url_split[5],
        }
        fs.writeFileSync(`vods/${username}/${fileName}`, JSON.stringify(data, null, 4))
    }


}

async function main() {
    if (timeoutCounter >= TIMEOUT_LIMIT) {
        log("TIMEOUT LIMIT REACHED!")
        exit()
    }

    const streamers = JSON.parse(fs.readFileSync("streamers.json", {encoding:'utf8'}))
    const token = await getToken()
    
    for(let id in streamers) {
        const res = await fetch(`https://api.twitch.tv/helix/videos?user_id=${id}&type=archive`,
            {
                "method": "GET",
                "headers": {
                    "Authorization": `Bearer ${token}`,
                    "Client-Id": process.env.CLIENT_ID
                }
            }
        )

        if (res.status != 200) {
            log("Status: " + res.status)
            timeoutCounter++
            continue
        } else {
            timeoutCounter = 0
        }

        const json = await res.json()
        const lastStream = json.data[0]
        if (lastStream.thumbnail_url != "") {
            logVod(lastStream)
        }
    }
}

main()
setInterval(main, 1000 * 15)