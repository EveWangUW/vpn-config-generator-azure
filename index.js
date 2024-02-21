import express from 'express'
import { execSync } from 'child_process'
import fs from 'fs/promises'
import dedent from 'dedent'
import fetch from 'node-fetch'

const app = express()
const port = 7779

app.use(express.static('public'));

app.get('/', async (req, res) => {
    const metadataUrl = 'http://169.254.169.254/latest/meta-data/public-ipv4';
    try {
        const response = await fetch(metadataUrl);
        if (!response.ok) {
            throw new Error('Failed to fetch public IP');
        }

        const publicIP = await response.text();

        const data = await fs.readFile('public/index.html', 'utf8');
        if (err) {
            console.error('Error reading HTML file:', err);
            return res.status(500).send('Server error');
        }
        
        const updatedHtml = data.replace('{{PUBLIC_IP}}', publicIP);

        res.send(updatedHtml);
    } catch (err) {
        res.status(500).send('Error fetching public IP address');
    }
});

app.get('/vpn-download', async (req, res) => {
    const metadataUrl = 'http://169.254.169.254/latest/meta-data/public-ipv4';
    try {
        const response = await fetch(metadataUrl);
        if (!response.ok) {
            throw new Error('Failed to fetch public IP');
        }
        const publicIP = await response.text();
        const config = await generateVpnConfig(publicIP);

        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', 'attachment; filename=open-devsecops-vpn.conf');
        res.send(config);
    } catch (err) {
        res.status(500).send('Error fetching public IP address');
    }
})

app.listen(port, '0.0.0.0', () => {
  console.log(`App listening on port ${port}`)
})

async function generateVpnConfig(publicIP) {
    const clientPubKeyCommand = `wg genkey | tee /tmp/privatekey | wg pubkey > /tmp/publickey`;
    execSync(clientPubKeyCommand);

    const clientPubKey = (await fs.readFile('/tmp/publickey', 'utf8')).trim();
    const clientPrivateKey = (await fs.readFile('/tmp/privatekey', 'utf8')).trim();
    const serverPubKey = (await fs.readFile('/etc/wireguard/public.key', 'utf8')).trim();

    const clientIp = await findNextAvailableIp();
    const configUpdateCommand = `echo -e "\n[Peer]\nPublicKey = ${clientPubKey}\nAllowedIPs = ${clientIp}/32" >> /etc/wireguard/wg0.conf`;
    execSync(`bash -c '${configUpdateCommand}'`);
    execSync('systemctl restart wg-quick@wg0.service');

    const clientConf = dedent(`
    [Interface]
    PrivateKey = ${clientPrivateKey}
    Address = ${clientIp}/32
    DNS = 192.168.77.1
    
    [Peer]
    PublicKey = ${serverPubKey}
    AllowedIPs = 0.0.0.0/0
    Endpoint = ${publicIP}:21210`);

    return clientConf;
}

async function findNextAvailableIp() {
    try {
        const data = await fs.readFile('/etc/wireguard/wg0.conf', 'utf8');
        const lines = data.split('\n');
        let highestLastOctet = 1;

        lines.forEach(line => {
            if (line.trim().startsWith('AllowedIPs')) {
                const ipPart = line.split('=')[1].trim().split('/')[0];
                const lastOctet = parseInt(ipPart.split('.')[3], 10);
                if (lastOctet > highestLastOctet) {
                    highestLastOctet = lastOctet;
                }
            }
        });

        const nextIpLastOctet = highestLastOctet + 1;
        if (nextIpLastOctet > 254) {
            throw new Error('No available IP addresses left in the subnet.');
        }

        return `192.168.77.${nextIpLastOctet}`;
    } catch (err) {
        console.error('Failed to find next available IP:', err);
        throw err;
    }
}